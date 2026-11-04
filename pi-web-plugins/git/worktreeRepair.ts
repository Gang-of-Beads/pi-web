import { lstat, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { findWorktreeLinks, type LinkedWorktree } from "./worktreeLinks.js";

/** A folder that moved, and every path inside it with it. */
export interface WorktreeMove {
  readonly from: string;
  readonly to: string;
}

/** What the repair asks of Git; the plugin runs each through its own `git`. */
export interface WorktreeRepairPorts {
  /** The worktree paths a repository records, its own first; undefined when Git cannot list them there. */
  readonly listWorktrees: (repository: string) => Promise<readonly string[] | undefined>;
  /** Whether a folder laid out like one is a bare repository; undefined when Git cannot say. */
  readonly isBare: (folder: string) => Promise<boolean | undefined>;
  /** `git worktree repair` in `cwd`, naming `paths`; throws when Git fails. */
  readonly repair: (cwd: string, paths: readonly string[]) => Promise<void>;
  /** A link left as it was, told as soon as it is known, so it is told even when the move is cut short. */
  readonly leave: (link: LeftLink) => void;
}

/** A link left as it was, and why. */
export interface LeftLink {
  readonly path: string;
  readonly reason: string;
}


/**
 * Where one repository's links stand after the move.
 * - `repair`: every worktree it records names it back, and a link names the old place.
 * - `intact`: every link already names where things are.
 * - `foreign`: a worktree it records names another repository, has no `.git` of its own, or has a
 *   folder where Git expects a file. A file copy of a repository keeps the original's records, and
 *   `git worktree repair` there would point the original's worktrees at the copy.
 * - `unlisted`: Git cannot list its worktrees here (another user's repository, a damaged one).
 * - `unreadable`: a worktree it records could not be read.
 */
type RepositoryVerdict = "repair" | "intact" | "foreign" | "unlisted" | "unreadable";

/**
 * Where one linked worktree inside the folder stands after the move.
 * - `repair`: its repository stayed, its record there names this worktree's old place, and every
 *   other worktree that repository records names it back. Git's repair, run in the worktree, goes
 *   over all of them, and would point the original's worktrees at a copy of a repository.
 * - `repository-foreign`: the same, but another worktree its repository records points elsewhere
 *   or could not be checked, so repairing this one would rewrite that one too.
 * - `intact`: its repository's record already names it here.
 * - `with-repository`: its repository moved with the folder and is repaired with it.
 * - `repository-unseen`: its repository moved with the folder but was not found to be repaired.
 * - `unrecorded`: its repository is gone or no longer records it.
 * - `foreign`: its repository's record names another worktree (this one is a copy).
 * - `unreadable`: the record could not be read.
 */
type WorktreeVerdict = "repair" | "repository-foreign" | "intact" | "with-repository" | "repository-unseen" | "unrecorded" | "foreign" | "unreadable";

const REPOSITORY_LEFT_BECAUSE: Readonly<Record<Exclude<RepositoryVerdict, "repair" | "intact">, string>> = {
  foreign: "a worktree it records names another repository or has no link back, so repairing it would take that worktree over",
  unlisted: "Git could not list its worktrees here",
  unreadable: "a worktree it records could not be read",
};

const WORKTREE_LEFT_BECAUSE: Readonly<Record<Exclude<WorktreeVerdict, "repair" | "intact" | "with-repository">, string>> = {
  "repository-foreign": "another worktree its repository records points elsewhere or could not be checked, and Git's repair would rewrite it too",
  "repository-unseen": "its repository moved with the folder but was not found to repair",
  unrecorded: "its repository is gone or no longer records it",
  foreign: "its repository's record names another worktree",
  unreadable: "its repository's record could not be read",
};

interface RepositoryPlace {
  readonly path: string;
  readonly bare: boolean;
  /** The repository's `worktrees` folder now, and where it was before the move. */
  readonly records: readonly [string, string];
}

/**
 * Repair the links between Git repositories and their linked worktrees that moving `from` to `to`
 * broke, everywhere inside the folder and with their partners elsewhere, where Git can repair them
 * without touching anyone else's. `git worktree repair` rewrites every link of the repository it
 * runs for that points elsewhere, whoever made it: run for a copy of a repository it points the
 * original's worktrees at the copy (rounds 6 and 7 of the review, reproduced with Git 2.55). So a
 * repository is repaired only when every worktree it records names it back and a link names the
 * old place, and a worktree whose repository stayed only when that repository's record names this
 * worktree's old place and every other worktree it records names it back. A repository with one
 * worktree that points elsewhere is left whole, its links the move broke included: Git cannot
 * repair one without the others. What is left is told to `ports.leave` with its reason; the
 * repository repairs Git refused come back, every repository tried first, and the move fails on
 * those.
 */
export async function repairMovedWorktrees(move: WorktreeMove, ports: WorktreeRepairPorts, signal: AbortSignal): Promise<readonly unknown[]> {
  const links = await findWorktreeLinks(move.to, signal);
  for (const path of links.unreadable) ports.leave({ path, reason: "the folder could not be read" });
  const repositories: RepositoryPlace[] = links.repositories.map(({ path }) => repositoryPlace(path, false, move));
  for (const candidate of links.bareCandidates) {
    signal.throwIfAborted();
    const bare = await ports.isBare(candidate);
    if (bare === true) repositories.push(repositoryPlace(candidate, true, move));
    if (bare === undefined) ports.leave({ path: candidate, reason: "Git could not say whether it is a repository" });
  }
  repositories.sort((a, b) => a.path.localeCompare(b.path));
  const failures: unknown[] = [];
  for (const repository of repositories) {
    signal.throwIfAborted();
    const { verdict, roots } = await repositoryVerdict(repository, move, ports);
    if (verdict === "repair") {
      await ports.repair(repository.path, roots).catch((error: unknown) => { failures.push(error); });
    } else if (verdict !== "intact") {
      ports.leave({ path: repository.path, reason: REPOSITORY_LEFT_BECAUSE[verdict] });
    }
  }
  for (const worktree of links.worktrees) {
    signal.throwIfAborted();
    const verdict = await worktreeVerdict(worktree, repositories, move, ports);
    if (verdict === "repair") {
      await ports.repair(worktree.path, []).catch((error: unknown) => {
        signal.throwIfAborted();
        ports.leave({ path: worktree.path, reason: `Git could not repair its repository's record: ${errorText(error)}` });
      });
    } else if (verdict !== "intact" && verdict !== "with-repository") {
      ports.leave({ path: worktree.path, reason: WORKTREE_LEFT_BECAUSE[verdict] });
    }
  }
  signal.throwIfAborted();
  return failures;
}

function repositoryPlace(path: string, bare: boolean, move: WorktreeMove): RepositoryPlace {
  const gitFolder = bare ? path : join(path, ".git");
  return { path, bare, records: [join(gitFolder, "worktrees"), join(movedInto(gitFolder, move.to, move.from) ?? gitFolder, "worktrees")] };
}

/**
 * Where a repository's links stand, from the records Git lists for it (its own worktree first)
 * and each worktree's `.git`. Called for a repository found inside the folder, and, from a linked
 * worktree whose repository stayed outside, for that repository: there the records did not move,
 * so both places are the same and the repository counts as bare, adding no root of its own.
 */
async function repositoryVerdict(repository: RepositoryPlace, move: WorktreeMove, ports: WorktreeRepairPorts): Promise<{ verdict: RepositoryVerdict; roots: string[] }> {
  const listed = await ports.listWorktrees(repository.path);
  if (listed === undefined) return { verdict: "unlisted", roots: [] };
  const roots = repository.bare ? [] : [repository.path];
  let broken = false;
  for (const recorded of listed.slice(1)) {
    const moved = movedInto(recorded, move.from, move.to);
    const now = moved ?? recorded;
    const link = await readLink(join(now, ".git"), now);
    if (link.kind === "no-folder") continue;
    if (link.kind === "unreadable") return { verdict: "unreadable", roots: [] };
    if (link.kind !== "names" || !repository.records.some((folder) => samePlace(dirname(link.target), folder))) return { verdict: "foreign", roots: [] };
    if (moved !== undefined) {
      roots.push(now);
      broken = true;
    }
    if (samePlace(dirname(link.target), repository.records[1]) && !samePlace(repository.records[0], repository.records[1])) broken = true;
  }
  return { verdict: broken ? "repair" : "intact", roots };
}

async function worktreeVerdict(worktree: LinkedWorktree, repositories: readonly RepositoryPlace[], move: WorktreeMove, ports: WorktreeRepairPorts): Promise<WorktreeVerdict> {
  const records = dirname(worktree.gitdir);
  if (repositories.some((repository) => repository.records.some((folder) => samePlace(records, folder)))) return "with-repository";
  const recordNow = movedInto(worktree.gitdir, move.from, move.to) ?? worktree.gitdir;
  const record = await readLink(join(recordNow, "gitdir"), recordNow, "");
  if (record.kind === "unreadable") return "unreadable";
  if (record.kind !== "names") return "unrecorded";
  if (insidePlace(worktree.gitdir, move.from) || insidePlace(worktree.gitdir, move.to)) return "repository-unseen";
  const here = join(worktree.path, ".git");
  if (samePlace(record.target, here)) return "intact";
  const moved = movedInto(record.target, move.from, move.to);
  if (moved === undefined || !samePlace(moved, here)) return "foreign";
  const owner = await repositoryVerdict({ path: worktree.path, bare: true, records: [records, records] }, move, ports);
  return owner.verdict === "repair" ? "repair" : "repository-foreign";
}

type Link = { readonly kind: "names"; readonly target: string } | { readonly kind: "no-folder" | "no-link" | "not-a-file" | "unreadable" };

/**
 * What a link file names, resolved against `base`: a worktree's `.git` (`gitdir: <path>`) or a
 * repository's record of one (`<path>`, `prefix` ""). "Nothing there" is told apart from a folder
 * where a file belongs and from a file that could not be read.
 */
async function readLink(file: string, base: string, prefix = "gitdir:"): Promise<Link> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (hasCode(error, ["EISDIR"])) return { kind: "not-a-file" };
    if (!hasCode(error, ["ENOENT", "ENOTDIR"])) return { kind: "unreadable" };
    try {
      await lstat(dirname(file));
      return { kind: "no-link" };
    } catch (folderError) {
      return hasCode(folderError, ["ENOENT", "ENOTDIR"]) ? { kind: "no-folder" } : { kind: "unreadable" };
    }
  }
  const line = text.split(/\r?\n/u).find((candidate) => candidate.startsWith(prefix));
  const named = line?.slice(prefix.length).trim();
  return named === undefined || named === "" ? { kind: "no-link" } : { kind: "names", target: resolve(base, named) };
}

/** A path as the file system compares it: on Windows without regard to letter case. */
function pathKey(path: string): string {
  const resolved = resolve(path);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function samePlace(left: string, right: string): boolean {
  return pathKey(left) === pathKey(right);
}

function insidePlace(path: string, folder: string): boolean {
  const key = pathKey(path);
  const base = pathKey(folder);
  return key === base || key.startsWith(base.endsWith(sep) ? base : `${base}${sep}`);
}

/**
 * Where `path` is after `from` moved to `to`, or undefined when it was not inside it. On Windows
 * Git keeps a path in the letter case it was made with, which need not match the folder's, so the
 * paths are compared there without regard to case and the rest keeps its own.
 */
function movedInto(path: string, from: string, to: string): string | undefined {
  if (!insidePlace(path, from)) return undefined;
  const rest = relative(resolve(from), resolve(path));
  return rest === "" ? to : join(to, rest);
}

function hasCode(error: unknown, codes: readonly string[]): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code: unknown = Reflect.get(error, "code");
  return typeof code === "string" && codes.includes(code);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
