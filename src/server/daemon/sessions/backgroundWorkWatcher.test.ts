import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { BackgroundWorkWatcher, type BackgroundWorkWatchHandle, type BackgroundWorkWatcherDependencies } from "./backgroundWorkWatcher.js";

class FakeWatch extends EventEmitter implements BackgroundWorkWatchHandle {
  closed = false;
  close(): void { this.closed = true; }
}

function target(sessionId = "s1") { return { sessionId, cwd: "/workspace", sessionFile: "/sessions/s1.jsonl" }; }

function fixture() {
  const watches = new Map<string, FakeWatch>();
  const dirty = vi.fn();
  let pendingTimer: (() => void) | undefined;
  const dependencies: BackgroundWorkWatcherDependencies = {
    watchDirectory: (path, onChange) => {
      const watcher = new FakeWatch();
      watcher.on("change", onChange);
      watches.set(path, watcher);
      return watcher;
    },
    setTimer: (callback) => {
      pendingTimer = callback;
      const timer = setTimeout(() => undefined, 60_000);
      timer.unref();
      return timer;
    },
    clearTimer: vi.fn(),
  };
  return { watcher: new BackgroundWorkWatcher(dirty, dependencies), watches, dirty, flush: () => { pendingTimer?.(); } };
}

describe("BackgroundWorkWatcher", () => {
  it("shares directory watches and releases them after the final session closes", () => {
    const { watcher, watches } = fixture();
    watcher.update(target("s1"));
    watcher.update(target("s2"));
    const pi = watches.get("/workspace/.pi");
    if (pi === undefined) throw new Error("expected workspace watch");
    expect(watches.size).toBe(4);
    watcher.forget("s1");
    expect(pi.closed).toBe(false);
    watcher.forget("s2");
    expect(pi.closed).toBe(true);
  });

  it("marks an errored required watch unhealthy so reconciliation resumes", () => {
    const { watcher, watches } = fixture();
    const watched = target();
    watcher.update(watched);
    expect(watcher.isHealthy(watched)).toBe(true);
    watches.get("/workspace/.pi")?.emit("error");
    expect(watcher.isHealthy(watched)).toBe(false);
  });

  it("coalesces filesystem changes into one refresh", () => {
    const { watcher, watches, dirty, flush } = fixture();
    watcher.update(target());
    watches.get("/workspace/.pi")?.emit("change");
    watches.get("/sessions")?.emit("change");
    expect(dirty).not.toHaveBeenCalled();
    flush();
    expect(dirty).toHaveBeenCalledTimes(1);
  });
});
