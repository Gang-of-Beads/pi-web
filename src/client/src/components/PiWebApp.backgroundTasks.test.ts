// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { SessionBackgroundTaskInfo } from "../../../shared/apiTypes";
import { sameBackgroundTasks } from "./PiWebApp";

function task(over: Partial<SessionBackgroundTaskInfo> = {}): SessionBackgroundTaskInfo {
  return {
    id: "task-1",
    name: "sleep timer",
    command: "sleep 120",
    status: "running",
    startedAt: "2026-08-25T10:00:00.000Z",
    durationMs: 30_000,
    hasOutput: true,
    bytesWritten: 0,
    ...over,
  };
}

describe("sameBackgroundTasks", () => {
  it("treats a changed duration as a change worth rendering", () => {
    // The row reports how long a task has been running, so a comparison that
    // ignores the duration freezes that number at whatever it was when the row
    // first appeared - a running task then reads as stuck.
    expect(sameBackgroundTasks([task()], [task({ durationMs: 95_000 })])).toBe(false);
  });

  it("ignores a byte counter that only ticks", () => {
    expect(sameBackgroundTasks([task({ bytesWritten: 10 })], [task({ bytesWritten: 4096 })])).toBe(true);
  });

  it("notices identity, status and exit changes", () => {
    expect(sameBackgroundTasks([task()], [task({ id: "task-2" })])).toBe(false);
    expect(sameBackgroundTasks([task()], [task({ status: "completed" })])).toBe(false);
    expect(sameBackgroundTasks([task()], [task({ exitCode: 1 })])).toBe(false);
    expect(sameBackgroundTasks([task()], [])).toBe(false);
  });
});
