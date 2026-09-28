import { describe, expect, it } from "vitest";
import { backgroundTaskList, durationLabel, taskPresentation, type TaskInput } from "./backgroundTaskRows";

const task = (id: string, status: string, startedAt: string, extra: Partial<TaskInput> = {}): TaskInput => ({ id, name: `task ${id}`, status, startedAt, ...extra });

describe("taskPresentation", () => {
  const expected: Record<string, [string, string]> = {
    running: ["running", "running"],
    completed: ["done", "done"],
    failed: ["problem", "failed"],
    killed: ["problem", "stopped"],
    lost: ["problem", "lost"],
    unknown: ["unknown", "unknown"],
  };
  for (const [status, [tone, label]] of Object.entries(expected)) {
    it(`names ${status} as ${label}`, () => {
      expect(taskPresentation(status)).toEqual({ tone, label });
    });
  }

  it("says a status it has no word for rather than guessing one", () => {
    expect(taskPresentation("timeout")).toEqual({ tone: "unknown", label: "timeout" });
    expect(taskPresentation("")).toEqual({ tone: "unknown", label: "unknown" });
  });
});

describe("backgroundTaskList", () => {
  it("puts running work first and the rest newest first", () => {
    const list = backgroundTaskList([
      task("old", "completed", "2026-09-28T10:00:00Z"),
      task("live", "running", "2026-09-28T09:00:00Z"),
      task("new", "failed", "2026-09-28T11:00:00Z"),
    ]);
    expect(list.running.map((row) => row.id)).toEqual(["live"]);
    expect(list.finished.map((row) => row.id)).toEqual(["new", "old"]);
    expect(list.hiddenFinished).toBe(0);
  });

  it("cuts a long history to the newest rows and counts the rest instead of dropping them silently", () => {
    const tasks = Array.from({ length: 407 }, (_, index) => task(String(index), "completed", `2026-09-28T10:${String(index % 60).padStart(2, "0")}:00Z`));
    const list = backgroundTaskList(tasks, 30);
    expect(list.finished).toHaveLength(30);
    expect(list.hiddenFinished).toBe(377);
  });

  it("keeps the name and the status apart, with duration and exit code as the detail", () => {
    const [row] = backgroundTaskList([task("a", "failed", "2026-09-28T10:00:00Z", { durationMs: 125_000, exitCode: 1 })]).finished;
    expect(row).toMatchObject({ name: "task a", label: "failed", tone: "problem", detail: "2m 5s · exit 1" });
  });
});

describe("durationLabel", () => {
  it("reads seconds, minutes and hours", () => {
    expect(durationLabel(9_000)).toBe("9s");
    expect(durationLabel(65_000)).toBe("1m 5s");
    expect(durationLabel(3_720_000)).toBe("1h 2m");
    expect(durationLabel(undefined)).toBeUndefined();
    expect(durationLabel(-1)).toBeUndefined();
  });
});
