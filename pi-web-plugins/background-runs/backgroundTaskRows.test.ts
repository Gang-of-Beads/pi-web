import { describe, expect, it } from "vitest";
import { backgroundListModel, backgroundTaskList, durationLabel, taskPresentation, type TaskInput, type TasksRead } from "./backgroundTaskRows";

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

describe("backgroundListModel", () => {
  const clock = (iso: string): string => iso.slice(11, 16);

  it("hands the host one group of running work and one of finished work", () => {
    const model = backgroundListModel([
      task("live", "running", "2026-09-28T09:00:00Z", { durationMs: 112_000 }),
      task("ok", "completed", "2026-09-28T08:38:00Z", { durationMs: 64_000, exitCode: 0 }),
      task("bad", "failed", "2026-09-28T08:35:00Z", { durationMs: 48_000, exitCode: 1 }),
      task("gone", "lost", "2026-09-28T08:30:00Z"),
      task("odd", "timeout", "2026-09-28T08:20:00Z"),
    ], "read", clock);
    expect(model.groups).toEqual([
      { id: "running", heading: "Running", rows: [{ id: "live", title: "task live", status: { label: "running", tone: "good" }, detail: "started 09:00 · 1m 52s" }] },
      { id: "finished", heading: "Finished", rows: [
        { id: "ok", title: "task ok", value: "exit 0", detail: "08:38 · 1m 4s" },
        { id: "bad", title: "task bad", status: { label: "exit 1", tone: "problem" }, detail: "08:35 · 48s" },
        { id: "gone", title: "task gone", status: { label: "lost", tone: "problem" }, detail: "08:30" },
        { id: "odd", title: "task odd", status: { label: "timeout", tone: "neutral" }, detail: "08:20" },
      ] },
    ]);
    expect(model.notes).toEqual([]);
  });

  it("names a read state for every page the session can show, and counts the runs it cuts", () => {
    const reads: [TasksRead, string][] = [["unread", "reading"], ["read", "ready"], ["failed", "failed"]];
    for (const [read, expected] of reads) expect(backgroundListModel([], read, clock).read).toBe(expected);
    expect(backgroundListModel([], "read", clock).words).toEqual({
      empty: "This session has started no background runs.",
      reading: "Reading this session's background runs…",
      failed: "This machine could not read the background runs.",
      stale: "Could not refresh - showing the last read.",
    });
    const many = Array.from({ length: 32 }, (_, index) => task(String(index), "completed", `2026-09-28T10:${String(index).padStart(2, "0")}:00Z`));
    expect(backgroundListModel(many, "read", clock).notes).toEqual(["2 older runs not shown"]);
  });
});
