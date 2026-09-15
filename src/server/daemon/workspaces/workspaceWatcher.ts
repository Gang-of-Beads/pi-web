import { watch } from "node:fs";

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
  watchDirectory(path: string, onChange: () => void): WorkspaceWatchHandle;
  setTimer(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimer(timer: ReturnType<typeof setTimeout>): void;
}

const defaultDependencies: WorkspaceWatcherDependencies = {
  watchDirectory: (path, onChange) => watch(path, { persistent: false, recursive: true }, onChange),
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (timer) => { clearTimeout(timer); },
};

export const WORKSPACE_CHANGE_DEBOUNCE_MS = 250;

export class WorkspaceWatcher {
  private readonly watchers = new Map<string, WorkspaceWatchHandle>();
  private readonly holders = new Map<string, Set<string>>();
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly publish: (event: WorkspaceChangedEvent) => void,
    private readonly dependencies: WorkspaceWatcherDependencies = defaultDependencies,
    private readonly debounceMs = WORKSPACE_CHANGE_DEBOUNCE_MS,
  ) {}

  /** A session holds its cwd open; the watch lives while any holder remains. */
  hold(sessionId: string, cwd: string): void {
    const holders = this.holders.get(cwd) ?? new Set<string>();
    holders.add(sessionId);
    this.holders.set(cwd, holders);
    if (this.watchers.has(cwd)) return;
    try {
      const handle = this.dependencies.watchDirectory(cwd, () => { this.markChanged(cwd); });
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
    for (const timer of this.pending.values()) this.dependencies.clearTimer(timer);
    this.pending.clear();
    for (const handle of this.watchers.values()) handle.close();
    this.watchers.clear();
    this.holders.clear();
  }

  private markChanged(cwd: string): void {
    if (this.pending.has(cwd)) return;
    this.pending.set(cwd, this.dependencies.setTimer(() => {
      this.pending.delete(cwd);
      if (!this.watchers.has(cwd)) return;
      this.publish({ type: "workspace.changed", cwd });
    }, this.debounceMs));
  }

  private dropWatch(cwd: string): void {
    const handle = this.watchers.get(cwd);
    if (handle === undefined) return;
    this.watchers.delete(cwd);
    handle.close();
    const timer = this.pending.get(cwd);
    if (timer !== undefined) {
      this.dependencies.clearTimer(timer);
      this.pending.delete(cwd);
    }
  }
}
