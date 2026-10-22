import { readFileSync, statSync, watch } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { watchablePath } from "./watchPath.js";
import { classifyWorkspaceChange, watchableDirectory, type WorkspaceChange } from "./workspaceChangeFilter.js";
import { watchDirectoryTree, type DirectoryTreeGrowthStop } from "./directoryTreeWatch.js";
import { DirectoryWatchBudget, directoryWatchBudgetSize } from "./directoryWatchBudget.js";
import { declaredAgentFacts } from "../sessions/declaredAgentFacts.js";

/**
 * Tells the room a workspace's files moved.
 *
 * Panels that show a workspace (files, git) refreshed only on demand: an
 * agent editing a file next to the reader left the panel stale until a tap.
 * The daemon already watches durable session directories; this watches the
 * working directories of the sessions it holds open - the folders someone is
 * looking at - and publishes one coalesced `workspace.changed` per burst on
 * the global realtime scope. The event names the directory and nothing more:
 * the browser decides whether that directory is the workspace it shows and
 * refreshes through the panel invalidation it already has. No plugin
 * contract changes.
 *
 * Watches are hints, not truth: a directory can vanish, fs.watch can drop
 * events, and a panel keeps its manual refresh. A watch that cannot be
 * established is dropped quietly - the panel is then exactly as fresh as
 * before this existed.
 */
export interface WorkspaceChangedEvent {
  readonly type: "workspace.changed";
  readonly cwd: string;
}

export interface WorkspaceWatchHandle {
  close(): void;
  on(event: "error", listener: () => void): unknown;
}

export interface WorkspaceWatcherDependencies {
  /**
   * `onChange` receives the changed path relative to the directory, when the platform names it.
   * `watchable` says which subdirectories, relative to the directory, are worth a watch where each directory needs its own.
   */
  watchDirectory(path: string, onChange: (relativePath?: string) => void, watchable?: (relativeDir: string) => boolean): WorkspaceWatchHandle;
  setTimer(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimer(timer: ReturnType<typeof setTimeout>): void;
  now(): number;
  /** Where a linked worktree keeps its git state: the `gitdir:` of a `.git` file, when `.git` is one. */
  linkedGitDir(path: string): string | undefined;
  /** Directories the running plugins declare their extensions write background work into, relative to the workspace. */
  workPaths(): readonly string[];
}

/**
 * Where `fs.watch` is natively recursive. Elsewhere (Linux) Node emulates it
 * with one watch per file and a quadratic forget, which froze the daemon for
 * minutes when a `node_modules` was deleted (issue #59), so the tree is
 * watched per directory instead.
 */
const NATIVE_RECURSIVE_WATCH_PLATFORMS: ReadonlySet<NodeJS.Platform> = new Set(["darwin", "win32"]);

const watchRecursively: WorkspaceWatcherDependencies["watchDirectory"] = (path, onChange) =>
  watch(watchablePath(path), { persistent: false, recursive: true }, (_event, filename) => { onChange(filename ?? undefined); });

/** The daemon's structured logger, shaped like Fastify's. */
export interface WorkspaceWatchLog {
  info(details: Record<string, unknown>, message: string): void;
  warn(details: Record<string, unknown>, message: string): void;
}

/**
 * The one line a tree logs when it first stops taking folders: running out
 * of system watches is a warning, a cap or the shared budget is expected on
 * very large folders.
 */
const GROWTH_STOP_LOG: Readonly<Record<DirectoryTreeGrowthStop, { readonly level: keyof WorkspaceWatchLog; readonly message: string }>> = {
  "workspace-limit": { level: "info", message: "workspace watch reached its folder limit; changes in deeper folders show on the panel's own refresh" },
  "daemon-budget": { level: "info", message: "workspace watch reached the daemon's shared folder budget; it resumes when other workspaces give folders back, and changes in unwatched folders show on the panel's own refresh" },
  "out-of-watches": { level: "warn", message: "the system ran out of file watches or descriptors; this workspace watch stops growing" },
};

/**
 * The real filesystem, clock and plugin declarations. Where each directory
 * needs its own watch, every tree draws from one budget, sized once from the
 * user's inotify limit on the first watch.
 */
export function workspaceWatcherDependencies(log: WorkspaceWatchLog): WorkspaceWatcherDependencies {
  let budget: DirectoryWatchBudget | undefined;
  const watchPerDirectory: WorkspaceWatcherDependencies["watchDirectory"] = (path, onChange, watchable = () => true) => {
    budget ??= new DirectoryWatchBudget(directoryWatchBudgetSize());
    return watchDirectoryTree(watchablePath(path), {
      onChange,
      watchable,
      budget,
      onGrowthStopped: (reason, watchedFolders, limit) => {
        const entry = GROWTH_STOP_LOG[reason];
        log[entry.level]({ folder: path, watchedFolders, ...(limit === undefined ? {} : { limit }) }, entry.message);
      },
    });
  };
  return {
    watchDirectory: NATIVE_RECURSIVE_WATCH_PLATFORMS.has(process.platform) ? watchRecursively : watchPerDirectory,
    setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimer: (timer) => { clearTimeout(timer); },
    now: () => performance.now(),
    linkedGitDir: readLinkedGitDir,
    workPaths: () => declaredAgentFacts().workPaths.filter((entry) => entry.root === "cwd").map((entry) => entry.path),
  };
}

function readLinkedGitDir(path: string): string | undefined {
  try {
    const dotGit = resolve(path, ".git");
    if (!statSync(dotGit).isFile()) return undefined;
    const target = /^gitdir:\s*(.+?)\s*$/mu.exec(readFileSync(dotGit, "utf8"))?.[1];
    return target === undefined ? undefined : resolve(path, target);
  } catch {
    return undefined;
  }
}

/**
 * The longest a change of each kind waits before its one publish (GitLens's
 * windows): git state is shown fast, the tree at most every 2.5 s however
 * busy the agent is.
 */
export const WORKSPACE_CHANGE_WINDOW_MS: Readonly<Record<Exclude<WorkspaceChange, "noise">, number>> = { "git-state": 250, tree: 2500 };

export class WorkspaceWatcher {
  private readonly watchers = new Map<string, WorkspaceWatchHandle>();
  private readonly holders = new Map<string, Set<string>>();
  private readonly pending = new Map<string, { due: number; timer: ReturnType<typeof setTimeout> }>();

  constructor(
    private readonly publish: (event: WorkspaceChangedEvent) => void,
    private readonly dependencies: WorkspaceWatcherDependencies,
  ) {}

  /** A session holds its cwd open; the watch lives while any holder remains. */
  hold(sessionId: string, cwd: string): void {
    const holders = this.holders.get(cwd) ?? new Set<string>();
    holders.add(sessionId);
    this.holders.set(cwd, holders);
    if (this.watchers.has(cwd)) return;
    try {
      const handle = this.watchWorkspace(cwd);
      handle.on("error", () => { this.dropWatch(cwd); });
      this.watchers.set(cwd, handle);
    } catch {
      this.holders.delete(cwd);
    }
  }

  release(sessionId: string, cwd: string): void {
    const holders = this.holders.get(cwd);
    if (holders === undefined) return;
    holders.delete(sessionId);
    if (holders.size > 0) return;
    this.holders.delete(cwd);
    this.dropWatch(cwd);
  }

  watchedDirectories(): readonly string[] {
    return [...this.watchers.keys()];
  }

  dispose(): void {
    for (const { timer } of this.pending.values()) this.dependencies.clearTimer(timer);
    this.pending.clear();
    for (const handle of this.watchers.values()) handle.close();
    this.watchers.clear();
    this.holders.clear();
  }

  /**
   * A linked worktree keeps its index and HEAD outside its own folder, under
   * the main repository's `.git/worktrees/<name>`; that directory is watched
   * too and read as the workspace's `.git`, so a commit there shows at once.
   */
  private watchWorkspace(cwd: string): WorkspaceWatchHandle {
    const tree = this.dependencies.watchDirectory(cwd, (relativePath) => { this.markChanged(cwd, relativePath); }, (dir) => watchableDirectory(dir, this.dependencies.workPaths()));
    const gitDir = this.dependencies.linkedGitDir(cwd);
    if (gitDir === undefined) return tree;
    try {
      const git = this.dependencies.watchDirectory(
        gitDir,
        (relativePath) => { this.markChanged(cwd, relativePath === undefined ? undefined : `.git/${relativePath}`); },
        (dir) => watchableDirectory(`.git/${dir}`, this.dependencies.workPaths()),
      );
      return bothWatches(tree, git);
    } catch {
      return tree;
    }
  }

  /**
   * One publish per window: the first change of a kind schedules it, later
   * changes ride along, and a kind with a shorter window brings it forward.
   */
  private markChanged(cwd: string, relativePath: string | undefined): void {
    const change = classifyWorkspaceChange(relativePath, this.dependencies.workPaths());
    if (change === "noise") return;
    const delayMs = WORKSPACE_CHANGE_WINDOW_MS[change];
    const due = this.dependencies.now() + delayMs;
    const pending = this.pending.get(cwd);
    if (pending !== undefined && pending.due <= due) return;
    if (pending !== undefined) this.dependencies.clearTimer(pending.timer);
    this.pending.set(cwd, {
      due,
      timer: this.dependencies.setTimer(() => {
        this.pending.delete(cwd);
        if (!this.watchers.has(cwd)) return;
        this.publish({ type: "workspace.changed", cwd });
      }, delayMs),
    });
  }

  private dropWatch(cwd: string): void {
    const handle = this.watchers.get(cwd);
    if (handle === undefined) return;
    this.watchers.delete(cwd);
    handle.close();
    const pending = this.pending.get(cwd);
    if (pending !== undefined) {
      this.dependencies.clearTimer(pending.timer);
      this.pending.delete(cwd);
    }
  }
}

function bothWatches(first: WorkspaceWatchHandle, second: WorkspaceWatchHandle): WorkspaceWatchHandle {
  const handle: WorkspaceWatchHandle = {
    close: () => {
      first.close();
      second.close();
    },
    on: (event, listener) => {
      first.on(event, listener);
      second.on(event, listener);
      return handle;
    },
  };
  return handle;
}
