import { lstatSync, watch, type FSWatcher, type Stats } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import type { DirectoryWatchBudget } from "./directoryWatchBudget.js";
import type { WorkspaceWatchHandle } from "./workspaceWatcher.js";

/**
 * Measured on Linux: 4096 directories are walked in ~120 ms without
 * stalling the event loop and cost ~15 MB; a large repository checkout with
 * several worktrees has ~1.9k watchable directories.
 */
const DIRECTORY_TREE_WATCH_LIMIT = 4096;

/** Why a tree stopped taking new folders: its own cap, the daemon's shared budget, or the system's watches or descriptors. */
export type DirectoryTreeGrowthStop = "workspace-limit" | "daemon-budget" | "out-of-watches";

const WATCH_EXHAUSTION_CODES = new Set(["ENOSPC", "EMFILE", "ENFILE"]);

const GIT_DIRECTORY = ".git";

interface DirectoryTreeWatchOptions {
  /** The changed path relative to the root, or undefined when the root itself changed without a name. */
  readonly onChange: (relativePath?: string) => void;
  /** Whether a directory, relative to the root, can hold changes worth watching. */
  readonly watchable: (relativeDir: string) => boolean;
  /** Shared by every tree of the daemon; a folder forgotten or closed is given back. */
  readonly budget: DirectoryWatchBudget;
  /** Called once per tree, the first time a folder worth watching is refused; `limit` is the one that applied, when known. */
  readonly onGrowthStopped: (reason: DirectoryTreeGrowthStop, watchedFolders: number, limit: number | undefined) => void;
}

/** What makes a directory the same one: a removed directory's inode can be handed straight to its replacement. */
interface DirectoryIdentity {
  readonly device: number;
  readonly inode: number;
  readonly birthtimeMs: number;
}

interface WatchedDirectory {
  readonly path: string;
  readonly identity: DirectoryIdentity;
  readonly parent: WatchedDirectory | undefined;
  readonly children: Map<string, WatchedDirectory>;
  readonly holdsGitState: boolean;
  watcher: FSWatcher | undefined;
  forgotten: boolean;
}

type DirectoryAdmission = "added" | "skipped" | "refused";

/**
 * An entry's own status, or undefined when it is gone or cannot be checked
 * (no search permission, a stale or disconnected mount, a path too long):
 * either way there is nothing this watch can follow there, and a throw
 * from an `fs.watch` listener would take the daemon down.
 */
function entryStats(path: string): Stats | undefined {
  try {
    return lstatSync(path, { throwIfNoEntry: false });
  } catch {
    return undefined;
  }
}

function identityOf(stats: Stats): DirectoryIdentity {
  return { device: stats.dev, inode: stats.ino, birthtimeMs: stats.birthtimeMs };
}

function sameDirectory(known: DirectoryIdentity, stats: Stats | undefined): boolean {
  if (stats?.isDirectory() !== true) return false;
  const current = identityOf(stats);
  const birthKnown = known.birthtimeMs !== 0 && current.birthtimeMs !== 0;
  return current.device === known.device && current.inode === known.inode && (!birthKnown || current.birthtimeMs === known.birthtimeMs);
}

/**
 * Watches a directory tree with one plain watch per directory (issue #59).
 *
 * On Linux, Node's `fs.watch(path, { recursive: true })` is JavaScript over
 * inotify: it walks the whole tree synchronously and opens one watch per
 * file and per directory, and it forgets each removed entry by scanning
 * every entry it knows. A daemon holding a few repositories open held
 * ~560k watches; deleting one `node_modules` kept its main thread at 100 %
 * for over 15 minutes, every API call timing out, with ~3 GB resident.
 * Another held 147k of the user's 232,789 inotify watches, a limit every
 * other program of that user shares.
 *
 * Here inotify does what it already does well: a directory's watch names
 * the entries that changed inside it, so only directories are watched, and
 * only the ones the caller calls `watchable` (dependency folders and git's
 * object store are never news). The root is watched synchronously, so a
 * root that cannot be watched throws; everything below is found by an
 * asynchronous breadth-first walk that arms a directory's watch before
 * reading it, and never follows a symbolic link. The root's `.git` is
 * walked before anything else, so the cap never cuts git state. A tree
 * keeps at most `DIRECTORY_TREE_WATCH_LIMIT` directories, the shallow ones,
 * and its subfolders also draw from the daemon's shared
 * `DirectoryWatchBudget`; a tree the budget refused resumes its walk when
 * folders are given back. A tree refused by its own cap is not walked again
 * when room frees, though new directories still join while there is room,
 * and it stops growing for good when the system runs out of watches or
 * descriptors. A directory that cannot be watched or checked for its own
 * reason (gone, unreadable, a dead mount) is skipped. The first refusal is
 * reported once, so the daemon logs one line per tree.
 *
 * Directories are kept parent to children, so a removed directory costs
 * its own subtree; a directory replaced under the same name (by device,
 * inode and, where the platform reports it, birth time) is forgotten and
 * walked again. An event without a name re-reads its directory. Watches
 * are hints: losing a subdirectory's watch forgets that subtree, and only
 * a failure of the root reaches `error`.
 */
export function watchDirectoryTree(root: string, options: DirectoryTreeWatchOptions): WorkspaceWatchHandle {
  const errorListeners = new Set<() => void>();
  const gitReads: WatchedDirectory[] = [];
  const pendingReads: WatchedDirectory[] = [];
  let watchedCount = 1;
  let exhausted = false;
  let cancelRoomWait: (() => void) | undefined;
  let growthStopReported = false;
  let walking = false;
  let closed = false;

  const rootDirectory: WatchedDirectory = { path: root, identity: identityOf(lstatSync(root)), parent: undefined, children: new Map(), holdsGitState: false, watcher: undefined, forgotten: false };
  rootDirectory.watcher = watch(root, { persistent: false }, (eventType, filename) => { onEvent(rootDirectory, eventType, filename); });
  rootDirectory.watcher.on("error", reportRootFailure);
  addDirectory(rootDirectory, GIT_DIRECTORY);
  pendingReads.push(rootDirectory);
  startWalk();

  function reportRootFailure(): void {
    if (closed) return;
    for (const listener of [...errorListeners]) listener();
  }

  function readsFor(directory: WatchedDirectory): WatchedDirectory[] {
    return directory.holdsGitState ? gitReads : pendingReads;
  }

  function reportGrowthStop(reason: DirectoryTreeGrowthStop, limit: number | undefined): void {
    if (growthStopReported) return;
    growthStopReported = true;
    options.onGrowthStopped(reason, watchedCount, limit);
  }

  function stopAtLimit(): void {
    gitReads.length = 0;
    pendingReads.length = 0;
    reportGrowthStop("workspace-limit", DIRECTORY_TREE_WATCH_LIMIT);
  }

  function stopOutOfWatches(): void {
    exhausted = true;
    gitReads.length = 0;
    pendingReads.length = 0;
    reportGrowthStop("out-of-watches", undefined);
  }

  function waitForBudget(unread: WatchedDirectory): void {
    const reads = readsFor(unread);
    if (!reads.includes(unread)) reads.unshift(unread);
    reportGrowthStop("daemon-budget", options.budget.size);
    if (cancelRoomWait !== undefined) return;
    cancelRoomWait = options.budget.whenRoomFrees(() => {
      cancelRoomWait = undefined;
      startWalk();
    });
  }

  function addDirectory(parent: WatchedDirectory, name: string, known?: Stats): DirectoryAdmission {
    if (closed || exhausted || parent.children.has(name)) return "skipped";
    const path = join(parent.path, name);
    if (!options.watchable(relative(root, path))) return "skipped";
    if (watchedCount >= DIRECTORY_TREE_WATCH_LIMIT) {
      stopAtLimit();
      return "refused";
    }
    const stats = known ?? entryStats(path);
    if (stats?.isDirectory() !== true) return "skipped";
    if (!options.budget.take()) {
      waitForBudget(parent);
      return "refused";
    }
    const holdsGitState = parent.holdsGitState || (parent === rootDirectory && name === GIT_DIRECTORY);
    const directory: WatchedDirectory = { path, identity: identityOf(stats), parent, children: new Map(), holdsGitState, watcher: undefined, forgotten: false };
    try {
      directory.watcher = watch(path, { persistent: false }, (eventType, filename) => { onEvent(directory, eventType, filename); });
    } catch (error) {
      options.budget.give(1);
      if (!(error instanceof Error && "code" in error && typeof error.code === "string" && WATCH_EXHAUSTION_CODES.has(error.code))) return "skipped";
      stopOutOfWatches();
      return "refused";
    }
    directory.watcher.on("error", () => { forget(directory); });
    parent.children.set(name, directory);
    watchedCount += 1;
    readsFor(directory).push(directory);
    startWalk();
    return "added";
  }

  function startWalk(): void {
    walk().catch(() => {
      gitReads.length = 0;
      pendingReads.length = 0;
    });
  }

  async function walk(): Promise<void> {
    if (walking) return;
    walking = true;
    try {
      while (!closed && !exhausted && cancelRoomWait === undefined) {
        const directory = gitReads.shift() ?? pendingReads.shift();
        if (directory === undefined) return;
        if (!directory.forgotten) await readChildren(directory);
      }
    } finally {
      walking = false;
    }
  }

  async function readChildren(directory: WatchedDirectory): Promise<void> {
    const entries = await readdir(directory.path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (directory.forgotten) return;
      if (entry.isDirectory() && addDirectory(directory, entry.name) === "refused") return;
    }
  }

  function onEvent(directory: WatchedDirectory, eventType: string, filename: string | null): void {
    if (closed || directory.forgotten) return;
    if (filename === null) {
      const path = relative(root, directory.path);
      options.onChange(path === "" ? undefined : path);
      rereadChildren(directory);
      return;
    }
    options.onChange(relative(root, join(directory.path, filename)));
    if (eventType !== "rename") return;
    if (filename === basename(directory.path)) reconcileItself(directory);
    reconcileChild(directory, filename);
  }

  function rereadChildren(directory: WatchedDirectory): void {
    for (const name of [...directory.children.keys()]) reconcileChild(directory, name);
    if (directory.forgotten) return;
    readsFor(directory).push(directory);
    startWalk();
  }

  function reconcileItself(directory: WatchedDirectory): void {
    if (directory.parent !== undefined) {
      reconcileChild(directory.parent, basename(directory.path));
      return;
    }
    if (!sameDirectory(directory.identity, entryStats(directory.path))) reportRootFailure();
  }

  function reconcileChild(parent: WatchedDirectory, name: string): void {
    if (parent.forgotten) return;
    const stats = entryStats(join(parent.path, name));
    const known = parent.children.get(name);
    if (known !== undefined && !sameDirectory(known.identity, stats)) forget(known);
    if (stats?.isDirectory() === true) addDirectory(parent, name, stats);
  }

  function forget(directory: WatchedDirectory): void {
    if (directory.forgotten) return;
    directory.parent?.children.delete(basename(directory.path));
    let givenBack = 0;
    const stack = [directory];
    for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
      next.forgotten = true;
      next.watcher?.close();
      watchedCount -= 1;
      if (next.parent !== undefined) givenBack += 1;
      stack.push(...next.children.values());
      next.children.clear();
    }
    options.budget.give(givenBack);
  }

  const handle: WorkspaceWatchHandle = {
    close: () => {
      if (closed) return;
      closed = true;
      cancelRoomWait?.();
      cancelRoomWait = undefined;
      gitReads.length = 0;
      pendingReads.length = 0;
      forget(rootDirectory);
    },
    on: (_event, listener) => {
      errorListeners.add(listener);
      return handle;
    },
  };
  return handle;
}
