import { describe, expect, it } from "vitest";
import { WorkspaceWatcher, type WorkspaceChangedEvent, type WorkspaceWatchHandle, type WorkspaceWatcherDependencies } from "./workspaceWatcher.js";

function harness(options: { failPaths?: readonly string[] } = {}) {
  const published: WorkspaceChangedEvent[] = [];
  const changeListeners = new Map<string, () => void>();
  const errorListeners = new Map<string, () => void>();
  const closed: string[] = [];
  const timers: { callback: () => void; handle: ReturnType<typeof setTimeout> }[] = [];
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
    setTimer: (callback) => {
      const handle = setTimeout(() => undefined, 60_000);
      handle.unref();
      timers.push({ callback, handle });
      return handle;
    },
    clearTimer: (timer) => {
      clearTimeout(timer);
      const index = timers.findIndex((entry) => entry.handle === timer);
      if (index >= 0) timers.splice(index, 1);
    },
  };
  const fireTimers = (): void => { for (const timer of timers.splice(0)) timer.callback(); };
  return { published, changeListeners, errorListeners, closed, timers, fireTimers, watcher: new WorkspaceWatcher((event) => published.push(event), dependencies) };
}

describe("WorkspaceWatcher", () => {
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
