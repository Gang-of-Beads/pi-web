import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

/** How many folders are read at once while a moved folder is looked through. */
const FOLDERS_READ_AT_ONCE = 16;

/** A working tree whose `.git` folder records linked worktrees. */
export interface WorktreeRepository {
  readonly path: string;
}

/** A linked worktree: its `.git` file names the folder in its repository that records it. */
export interface LinkedWorktree {
  readonly path: string;
  /** What its `.git` file names, resolved: `<repository's git folder>/worktrees/<name>`. */
  readonly gitdir: string;
}

export interface WorktreeLinks {
  readonly repositories: readonly WorktreeRepository[];
  readonly worktrees: readonly LinkedWorktree[];
  /** Folders laid out like a bare repository with worktrees; only Git can say whether they are one. */
  readonly bareCandidates: readonly string[];
  /** Folders this user may not read, so whatever they hold is not this user's Git's to use either. */
  readonly unreadable: readonly string[];
}

/**
 * Everything inside `folder`, the folder itself included, that Git links to another place by
 * path: working trees whose `.git` folder records linked worktrees, linked worktrees
 * (a `.git` file naming `<git folder>/worktrees/<name>`; a submodule's names its own repository and
 * is relative, so it survives a move), and folders that may be bare repositories with worktrees.
 * The whole tree is read, every repository and worktree whether it is a project or not; a `.git`
 * folder is looked at, not into, and links are not followed. Only "nothing there" counts as
 * absence: a folder this user may not read is named in `unreadable`, any other failure to read is
 * an error.
 */
export async function findWorktreeLinks(folder: string, signal: AbortSignal): Promise<WorktreeLinks> {
  const repositories: WorktreeRepository[] = [];
  const worktrees: LinkedWorktree[] = [];
  const bareCandidates: string[] = [];
  const unreadable: string[] = [];
  const visit = async (dir: string): Promise<string[]> => {
    signal.throwIfAborted();
    const entries = await readFolder(dir, unreadable);
    const names = new Set(entries.map(({ name }) => name));
    if (["HEAD", "objects", "refs", "worktrees"].every((name) => names.has(name))) bareCandidates.push(dir);
    const children: string[] = [];
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.name !== ".git") {
        if (entry.isDirectory()) children.push(path);
        continue;
      }
      if (entry.isDirectory() && (await readFolder(join(path, "worktrees"), unreadable)).length > 0) repositories.push({ path: dir });
      const gitdir = entry.isFile() ? await linkedGitdir(path, dir, unreadable) : undefined;
      if (gitdir !== undefined) worktrees.push({ path: dir, gitdir });
    }
    return children;
  };
  await eachFolder(folder, visit);
  return { repositories, worktrees, bareCandidates, unreadable };
}

/**
 * Visit `start` and every folder its visits return, a few at a time. The first failure stops new
 * visits; the ones already running are waited for, so none rejects with nobody listening. A folder
 * of a hundred thousand entries is queued one by one, not spread into one call.
 */
async function eachFolder(start: string, visit: (dir: string) => Promise<string[]>): Promise<void> {
  const pending = [start];
  const running = new Set<Promise<void>>();
  const failures: unknown[] = [];
  const visitOne = async (dir: string): Promise<void> => {
    try {
      for (const child of await visit(dir)) pending.push(child);
    } catch (error) {
      failures.push(error);
    }
  };
  for (;;) {
    while (failures.length === 0 && running.size < FOLDERS_READ_AT_ONCE) {
      const dir = pending.pop();
      if (dir === undefined) break;
      const task: Promise<void> = visitOne(dir).finally(() => { running.delete(task); });
      running.add(task);
    }
    if (running.size === 0) break;
    await Promise.race(running);
  }
  if (failures.length > 0) throw failures[0];
}

/** A folder's entries; none when it is gone or is not a folder, and none, with the folder named, when this user may not read it. */
async function readFolder(dir: string, unreadable: string[]): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (hasCode(error, ["ENOENT", "ENOTDIR"])) return [];
    if (hasCode(error, ["EACCES", "EPERM"])) {
      unreadable.push(dir);
      return [];
    }
    throw error;
  }
}

/** The worktree folder a `.git` file names, or undefined when it names none (a submodule's). */
async function linkedGitdir(file: string, dir: string, unreadable: string[]): Promise<string | undefined> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (hasCode(error, ["ENOENT", "ENOTDIR"])) return undefined;
    if (hasCode(error, ["EACCES", "EPERM"])) {
      unreadable.push(file);
      return undefined;
    }
    throw error;
  }
  const named = /^gitdir:\s*(.+?)\s*$/mu.exec(text)?.[1];
  if (named === undefined) return undefined;
  const gitdir = resolve(dir, named);
  return basename(dirname(gitdir)) === "worktrees" ? gitdir : undefined;
}

function hasCode(error: unknown, codes: readonly string[]): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code: unknown = Reflect.get(error, "code");
  return typeof code === "string" && codes.includes(code);
}
