import { watch } from "node:fs";
import { basename, dirname, join } from "node:path";

export interface BackgroundWorkWatchTarget {
  sessionId: string;
  cwd: string;
  sessionFile: string | undefined;
}

export interface BackgroundWorkWatchHandle {
  close(): void;
  on(event: "error", listener: () => void): unknown;
}

export interface BackgroundWorkWatcherDependencies {
  watchDirectory(path: string, onChange: () => void): BackgroundWorkWatchHandle;
  setTimer(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimer(timer: ReturnType<typeof setTimeout>): void;
}

const defaultDependencies: BackgroundWorkWatcherDependencies = {
  watchDirectory: (path, onChange) => watch(path, { persistent: false }, onChange),
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (timer) => { clearTimeout(timer); },
};

/**
 * Watches the durable files that detached work writes, and coalesces their
 * changes into one immediate recount. Watches are hints only: callers retain a
 * periodic reconciliation because directories may not exist yet and fs.watch
 * can lose events on some filesystems.
 */
export class BackgroundWorkWatcher {
  private readonly watchersByPath = new Map<string, BackgroundWorkWatchHandle>();
  private readonly pathsBySession = new Map<string, Set<string>>();
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly onDirty: () => void,
    private readonly dependencies: BackgroundWorkWatcherDependencies = defaultDependencies,
    private readonly debounceMs = 100,
  ) {}

  update(target: BackgroundWorkWatchTarget): void {
    const next = watchedPaths(target);
    const previous = this.pathsBySession.get(target.sessionId) ?? new Set<string>();
    this.pathsBySession.set(target.sessionId, next);
    for (const path of previous) {
      if (next.has(path)) continue;
      this.release(path);
    }
    for (const path of next) {
      if (previous.has(path)) continue;
      this.acquire(path);
    }
  }

  /** Whether every durable parent needed to discover new work is watched. */
  isHealthy(target: BackgroundWorkWatchTarget): boolean {
    return [...requiredWatchPaths(target)].every((path) => this.watchersByPath.has(path));
  }

  forget(sessionId: string): void {
    const paths = this.pathsBySession.get(sessionId);
    if (paths === undefined) return;
    this.pathsBySession.delete(sessionId);
    for (const path of paths) this.release(path);
  }

  dispose(): void {
    if (this.refreshTimer !== undefined) this.dependencies.clearTimer(this.refreshTimer);
    this.refreshTimer = undefined;
    for (const watcher of this.watchersByPath.values()) watcher.close();
    this.watchersByPath.clear();
    this.pathsBySession.clear();
  }

  private acquire(path: string): void {
    if (this.watchersByPath.has(path)) return;
    try {
      const watcher = this.dependencies.watchDirectory(path, () => { this.markDirty(); });
      watcher.on("error", () => { this.invalidate(path); });
      this.watchersByPath.set(path, watcher);
    } catch {
      // Missing/unsupported paths are recovered by the periodic reconciliation.
    }
  }

  /** An errored watcher no longer represents a healthy observation, even while sessions still need it. */
  private invalidate(path: string): void {
    const watcher = this.watchersByPath.get(path);
    this.watchersByPath.delete(path);
    watcher?.close();
  }

  private release(path: string): void {
    const stillUsed = [...this.pathsBySession.values()].some((paths) => paths.has(path));
    if (stillUsed) return;
    const watcher = this.watchersByPath.get(path);
    this.watchersByPath.delete(path);
    watcher?.close();
  }

  private markDirty(): void {
    if (this.refreshTimer !== undefined) return;
    this.refreshTimer = this.dependencies.setTimer(() => {
      this.refreshTimer = undefined;
      this.onDirty();
    }, this.debounceMs);
  }
}

function watchedPaths(target: BackgroundWorkWatchTarget): Set<string> {
  const paths = requiredWatchPaths(target);
  if (target.sessionFile === undefined) return paths;
  const sessionDir = dirname(target.sessionFile);
  paths.add(join(sessionDir, "subagent-artifacts"));
  paths.add(join(sessionDir, basename(target.sessionFile, ".jsonl")));
  return paths;
}

/** Parent directories exist before their optional task/artifact children. */
function requiredWatchPaths(target: BackgroundWorkWatchTarget): Set<string> {
  const paths = new Set([join(target.cwd, ".pi")]);
  if (target.sessionFile !== undefined) paths.add(dirname(target.sessionFile));
  return paths;
}
