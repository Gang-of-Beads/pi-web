import { describe, expect, it } from "vitest";
import { WorkspaceWatcher, type WorkspaceChangedEvent, type WorkspaceWatchHandle, type WorkspaceWatcherDependencies } from "./workspaceWatcher.js";

function harness(options: { failPaths?: readonly string[]; gitDirs?: Readonly<Record<string, string>> } = {}) {
  const published: WorkspaceChangedEvent[] = [];
  const changeListeners = new Map<string, (relativePath?: string) => void>();
  const errorListeners = new Map<string, () => void>();
  const closed: string[] = [];
  const timers: { callback: () => void; handle: ReturnType<typeof setTimeout>; delayMs: number }[] = [];
  let now = 0;
  const dependencies: WorkspaceWatcherDependencies = {
    watchDirectory: (path, onChange) => {
      if (options.failPaths?.includes(path) === true) throw new Error(`ENOENT ${path}`);
      changeListeners.set(path, onChange);
      const handle: WorkspaceWatchHandle = {
        close: () => { closed.push(path); },
        on: (_event, listener) => { errorListeners.set(path, listener); return handle; },
      };
      return handle;
    },
    setTimer: (callback, delayMs) => {
      const handle = setTimeout(() => undefined, 60_000);
      handle.unref();
      timers.push({ callback, handle, delayMs });
      return handle;
    },
    now: () => now,
    linkedGitDir: (path) => options.gitDirs?.[path],
    workPaths: () => [".pi/tasks", ".pi/delegate"],
    clearTimer: (timer) => {
      clearTimeout(timer);
      const index = timers.findIndex((entry) => entry.handle === timer);
      if (index >= 0) timers.splice(index, 1);
    },
  };
  const fireTimers = (): void => { for (const timer of timers.splice(0)) timer.callback(); };
  const advance = (ms: number): void => { now += ms; };
  return { published, changeListeners, errorListeners, closed, timers, fireTimers, advance, watcher: new WorkspaceWatcher((event) => published.push(event), dependencies) };
}

describe("WorkspaceWatcher", () => {
  it("publishes nothing for git's own churn, dependency folders or pi's task logs", () => {
    const h = harness();
    h.watcher.hold("s1", "/repo");
    for (const path of [".git/objects/ab/cdef", ".git/index.lock", "node_modules/lit/index.js", ".pi/tasks/abc.output"]) h.changeListeners.get("/repo")?.(path);
    expect(h.timers).toHaveLength(0);
    h.fireTimers();
    expect(h.published).toEqual([]);
  });

  it("publishes a git state change within 250 ms and a tree change within 2.5 s, and the sooner one wins", () => {
    const h = harness();
    h.watcher.hold("s1", "/repo");
    h.changeListeners.get("/repo")?.("src/app.ts");
    expect(h.timers.map((timer) => timer.delayMs)).toEqual([2500]);
    h.advance(100);
    h.changeListeners.get("/repo")?.("src/other.ts");
    expect(h.timers.map((timer) => timer.delayMs)).toEqual([2500]);
    h.changeListeners.get("/repo")?.(".git/index");
    expect(h.timers.map((timer) => timer.delayMs)).toEqual([250]);
    h.fireTimers();
    expect(h.published).toEqual([{ type: "workspace.changed", cwd: "/repo" }]);
  });

  it("watches a linked worktree's git state where it lives, and reads it as the workspace's .git", () => {
    const h = harness({ gitDirs: { "/wt": "/repo/.git/worktrees/wt" } });
    h.watcher.hold("s1", "/wt");
    h.changeListeners.get("/repo/.git/worktrees/wt")?.("logs/HEAD");
    expect(h.timers).toHaveLength(0);
    h.changeListeners.get("/repo/.git/worktrees/wt")?.("index");
    expect(h.timers.map((timer) => timer.delayMs)).toEqual([250]);
    h.fireTimers();
    expect(h.published).toEqual([{ type: "workspace.changed", cwd: "/wt" }]);
    h.watcher.release("s1", "/wt");
    expect(h.closed).toEqual(["/wt", "/repo/.git/worktrees/wt"]);
  });

  it("keeps an earlier publish when a later-due change arrives", () => {
    const h = harness();
    h.watcher.hold("s1", "/repo");
    h.changeListeners.get("/repo")?.(".git/index");
    h.changeListeners.get("/repo")?.("src/app.ts");
    expect(h.timers.map((timer) => timer.delayMs)).toEqual([250]);
  });

  it("watches a held directory once and coalesces a burst into one event", () => {
    const h = harness();
    h.watcher.hold("s1", "/repo");
    h.watcher.hold("s2", "/repo");
    expect(h.watcher.watchedDirectories()).toEqual(["/repo"]);
    h.changeListeners.get("/repo")?.();
    h.changeListeners.get("/repo")?.();
    h.changeListeners.get("/repo")?.();
    expect(h.timers).toHaveLength(1);
    h.fireTimers();
    expect(h.published).toEqual([{ type: "workspace.changed", cwd: "/repo" }]);
  });

  it("keeps the watch while any holder remains and drops it with the last", () => {
    const h = harness();
    h.watcher.hold("s1", "/repo");
    h.watcher.hold("s2", "/repo");
    h.watcher.release("s1", "/repo");
    expect(h.watcher.watchedDirectories()).toEqual(["/repo"]);
    h.watcher.release("s2", "/repo");
    expect(h.watcher.watchedDirectories()).toEqual([]);
    expect(h.closed).toEqual(["/repo"]);
  });

  it("never publishes for a directory whose watch was released mid-debounce", () => {
    const h = harness();
    h.watcher.hold("s1", "/repo");
    h.changeListeners.get("/repo")?.();
    h.watcher.release("s1", "/repo");
    h.fireTimers();
    expect(h.published).toEqual([]);
  });

  it("drops a watch on error and on a directory that cannot be watched, without throwing", () => {
    const h = harness({ failPaths: ["/gone"] });
    h.watcher.hold("s1", "/gone");
    expect(h.watcher.watchedDirectories()).toEqual([]);
    h.watcher.hold("s2", "/repo");
    h.errorListeners.get("/repo")?.();
    expect(h.watcher.watchedDirectories()).toEqual([]);
    expect(h.closed).toEqual(["/repo"]);
  });

  it("releases everything on dispose", () => {
    const h = harness();
    h.watcher.hold("s1", "/a");
    h.watcher.hold("s2", "/b");
    h.changeListeners.get("/a")?.();
    h.watcher.dispose();
    expect(h.watcher.watchedDirectories()).toEqual([]);
    expect(h.timers).toEqual([]);
    expect(h.closed.sort()).toEqual(["/a", "/b"]);
  });
});
