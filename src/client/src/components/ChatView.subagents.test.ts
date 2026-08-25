// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { SessionBackgroundTaskInfo, SessionSubagentInfo, SessionSubagentRunInfo } from "../../../shared/apiTypes";
import { backgroundTaskRows, activityFilterInEffect, activityFilterOptions, activityStripSummary, activityTabLabel, ChatView, subagentStatusLabel, isActiveActivityStatus, orderActivityEntries, type ActivityListEntry, selectedTopDrawerTab, subagentRows, subagentRunDuration, subagentRunRows, topDrawerStartsOpen } from "./ChatView";

const SUBAGENTS: SessionSubagentInfo[] = [
  { sessionId: "01a0child-0001-0000-000000000001", cwd: "/repo/.pi/sub", status: "working" },
  { sessionId: "01a0child-0002-0000-000000000002", cwd: "/repo/.pi/sub", status: "idle" },
];

async function mount(subagents: readonly SessionSubagentInfo[]): Promise<{ view: ChatView; host: HTMLElement | DocumentFragment; onOpenSubagent: ReturnType<typeof vi.fn> }> {
  const view = new ChatView();
  view.sessionId = "parent-1";
  view.subagents = subagents;
  const onOpenSubagent = vi.fn<(info: SessionSubagentInfo) => void>();
  view.onOpenSubagent = onOpenSubagent;
  document.body.append(view);
  await view.updateComplete;
  return { view, host: view.renderRoot, onOpenSubagent };
}

async function mountTasks(
  tasks: readonly SessionBackgroundTaskInfo[],
  onOpen?: (task: SessionBackgroundTaskInfo) => void,
): Promise<HTMLElement | DocumentFragment> {
  const view = new ChatView();
  view.sessionId = "parent-1";
  view.backgroundTasks = tasks;
  if (onOpen !== undefined) view.onOpenBackgroundTask = onOpen;
  document.body.append(view);
  await view.updateComplete;
  return view.renderRoot;
}

describe("subagents strip", () => {
  // The list answers "what is happening now" first: finished work waits behind
  // one control instead of burying the two rows that are still going.
  it("lists the working subagent, keeps the finished one behind the history control, and opens one on tap", async () => {
    const { view, host, onOpenSubagent } = await mount(SUBAGENTS);

    const active = [...host.querySelectorAll(".subagent-row")];
    expect(active.length).toBe(1);
    expect(host.textContent).toContain("Activity \u00b7 1 running");
    expect(active[0]?.getAttribute("aria-label")).toBe("Working subagent 00000001");

    host.querySelector<HTMLButtonElement>(".activity-history-toggle")?.click();
    await view.updateComplete;
    const all = [...host.querySelectorAll(".subagent-row")];
    expect(all.length).toBe(2);
    expect(all[1]?.getAttribute("aria-label")).toBe("Idle subagent 00000002");

    all[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onOpenSubagent).toHaveBeenCalledExactlyOnceWith(SUBAGENTS[0]);
  });

  it("stays folded for finished work and explains itself once opened", async () => {
    const host = await mountTasks([
      { id: "a", name: "Verify suite", command: "npm run verify", status: "completed", startedAt: "2026-08-21T19:00:00.000Z", durationMs: 55_000, exitCode: 0, bytesWritten: 12, hasOutput: true },
      { id: "b", name: "Install deps", command: "npm ci", status: "completed", startedAt: "2026-08-21T19:00:00.000Z", durationMs: 5_000, exitCode: 0, bytesWritten: 12, hasOutput: true },
    ]);

    expect(host.querySelector<HTMLElement>(".drawer-body")?.hidden).toBe(true);
    expect(host.textContent).toContain("2 done");

    host.querySelector<HTMLButtonElement>(".drawer-toggle")?.click();
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(host.querySelector<HTMLElement>(".drawer-body")?.hidden).toBe(false);
    // Nothing is running, so the panel says so and explains what it is for.
    expect(host.textContent).toContain("Nothing running right now");
    expect(host.textContent).toContain("Work this chat started in the background");
    expect(host.querySelectorAll(".subagent-row").length).toBe(0);

    host.querySelector<HTMLButtonElement>(".activity-history-toggle")?.click();
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(host.querySelectorAll(".subagent-row").length).toBe(2);
  });

  it("renders nothing when the session has no subagents", async () => {
    const { host } = await mount([]);
    expect(host.querySelector(".subagents-strip")).toBeNull();
  });

  // The strip shares the top of the transcript with the notification tray, so
  // it has to be foldable or a long-running conversation reads through a
  // letterbox.
  it("folds the drawer away to its header and unfolds it again", async () => {
    const { view, host } = await mount(SUBAGENTS);

    expect(host.querySelector(".drawer-toggle")?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector<HTMLElement>(".drawer-body")?.hidden).toBe(false);

    host.querySelector<HTMLButtonElement>(".drawer-toggle")?.click();
    await view.updateComplete;
    expect(host.querySelector(".drawer-toggle")?.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector<HTMLElement>(".drawer-body")?.hidden).toBe(true);
    // Folded, the header still reports what is running.
    expect(host.textContent).toContain("1 running");

    host.querySelector<HTMLButtonElement>(".drawer-toggle")?.click();
    await view.updateComplete;
    expect(host.querySelector<HTMLElement>(".drawer-body")?.hidden).toBe(false);
  });
});

describe("topDrawerStartsOpen", () => {
  // The complaint this answers: two finished background tasks covered a third
  // of a phone screen and could not be closed.
  it("stays folded when everything is finished", () => {
    expect(topDrawerStartsOpen({ working: false, failed: false, notifications: false })).toBe(false);
  });

  it("opens itself only for work in flight, failures, or notifications", () => {
    expect(topDrawerStartsOpen({ working: true, failed: false, notifications: false })).toBe(true);
    expect(topDrawerStartsOpen({ working: false, failed: true, notifications: false })).toBe(true);
    expect(topDrawerStartsOpen({ working: false, failed: false, notifications: true })).toBe(true);
  });
});

describe("selectedTopDrawerTab", () => {
  // The drawer must never show an empty section: a section can empty out while
  // the reader is looking at it (the last notification is dismissed, the last
  // subagent finishes and is cleared).
  it("keeps the reader's section while it has content", () => {
    expect(selectedTopDrawerTab({ activity: true, notifications: true }, "activity")).toBe("activity");
    expect(selectedTopDrawerTab({ activity: true, notifications: true }, "notifications")).toBe("notifications");
  });

  it("falls back to the section that exists", () => {
    expect(selectedTopDrawerTab({ activity: true, notifications: false }, "notifications")).toBe("activity");
    expect(selectedTopDrawerTab({ activity: false, notifications: true }, "activity")).toBe("notifications");
    expect(selectedTopDrawerTab({ activity: true, notifications: false }, undefined)).toBe("activity");
    expect(selectedTopDrawerTab({ activity: true, notifications: true }, undefined)).toBe("notifications");
  });
});

describe("activityStripSummary", () => {
  it("counts running, failed and finished work for the folded header", () => {
    expect(activityStripSummary(["working", "running", "failed", "idle", "done"]))
      .toEqual({ label: "2 running \u00b7 1 failed \u00b7 2 done", working: true, failed: true });
  });

  it("omits empty groups and reports a quiet strip as not working", () => {
    expect(activityStripSummary(["done", "done"])).toEqual({ label: "2 done", working: false, failed: false });
    expect(activityStripSummary([])).toEqual({ label: "", working: false, failed: false });
  });
});

const RUNS: SessionSubagentRunInfo[] = [
  { runId: "run-live", agent: "scout", status: "running", elapsedMs: 42_000, startedAt: "2026-08-21T10:00:00.000Z", lastActivity: "bash", hasOutput: false },
  { runId: "run-done", agent: "reviewer", status: "done", elapsedMs: 125_000, startedAt: "2026-08-21T09:00:00.000Z", task: "review the diff", hasOutput: true },
];

async function mountRuns(runs: readonly SessionSubagentRunInfo[]): Promise<{ view: ChatView; host: HTMLElement | DocumentFragment; onOpenSubagentRun: ReturnType<typeof vi.fn> }> {
  const view = new ChatView();
  view.sessionId = "parent-1";
  view.subagentRuns = runs;
  const onOpenSubagentRun = vi.fn<(run: SessionSubagentRunInfo) => void>();
  view.onOpenSubagentRun = onOpenSubagentRun;
  document.body.append(view);
  await view.updateComplete;
  return { view, host: view.renderRoot, onOpenSubagentRun };
}

describe("subagent tool runs", () => {
  it("lists runs with agent, status, elapsed time and current step", async () => {
    // These runs are not sessions, so this strip is the only place they are
    // visible anywhere in the UI.
    const { view, host } = await mountRuns(RUNS);

    expect(host.textContent).toContain("Activity \u00b7 1 running");
    expect(host.textContent).toContain("scout");
    expect(host.textContent).toContain("Running");
    expect(host.textContent).toContain("42s");
    expect(host.textContent).toContain("bash");

    // The finished run and its task are one control away.
    host.querySelector<HTMLButtonElement>(".activity-history-toggle")?.click();
    await view.updateComplete;
    expect(host.textContent).toContain("review the diff");
  });

  // Every run opens, finished or not: a run with no result file yet falls back
  // to its own transcript, so the row always leads somewhere.
  it("opens both a finished run and one still going", async () => {
    const { view, host, onOpenSubagentRun } = await mountRuns(RUNS);

    const running = [...host.querySelectorAll(".subagent-row")];
    running[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onOpenSubagentRun).toHaveBeenCalledExactlyOnceWith(RUNS[0]);

    host.querySelector<HTMLButtonElement>(".activity-history-toggle")?.click();
    await view.updateComplete;
    const all = [...host.querySelectorAll(".subagent-row")];
    all[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onOpenSubagentRun).toHaveBeenLastCalledWith(RUNS[1]);
    expect(onOpenSubagentRun).toHaveBeenCalledTimes(2);
  });
});

describe("subagentRunRows", () => {
  it("shows the live step while running and the task once finished", () => {
    const [live, done] = subagentRunRows(RUNS);
    expect(live).toMatchObject({ statusLabel: "Running", duration: "42s", detail: "bash" });
    expect(done).toMatchObject({ statusLabel: "Done", duration: "2m 5s", detail: "review the diff" });
  });

  it("formats durations at every scale", () => {
    expect(subagentRunDuration(900)).toBe("1s");
    expect(subagentRunDuration(65_000)).toBe("1m 5s");
    expect(subagentRunDuration(3_900_000)).toBe("1h 5m");
  });
});

// The pure seam: rendered rows derive their fields once, so the strip stays a
// dumb map and this shape is what the template consumes.
describe("subagentRows", () => {
  it("shortens ids and labels status with a caption word", () => {
    expect(subagentRows(SUBAGENTS)).toEqual([
      { subagent: SUBAGENTS[0], shortId: "00000001", status: "working", statusLabel: "Working", cwd: "/repo/.pi/sub", ariaLabel: "Working subagent 00000001" },
      { subagent: SUBAGENTS[1], shortId: "00000002", status: "idle", statusLabel: "Idle", cwd: "/repo/.pi/sub", ariaLabel: "Idle subagent 00000002" },
    ]);
  });
});

describe("background tasks", () => {
  it("lists tasks with status, duration and exit code, and opens the log", async () => {
    const opened: string[] = [];
    const host = await mountTasks([
      { id: "b96da5ec8", name: "deploy 1.202608.13", command: "bash scripts/deploy.sh", status: "running", startedAt: "2026-08-21T20:00:00.000Z", durationMs: 421_000, bytesWritten: 0, hasOutput: true },
      { id: "b25b68e87", name: "verify", command: "npm test", status: "completed", startedAt: "2026-08-21T19:00:00.000Z", durationMs: 132_000, exitCode: 0, bytesWritten: 317, hasOutput: true },
    ], (task) => { opened.push(task.id); });

    const text = host.textContent;
    expect(text).toContain("Activity \u00b7 1 running");
    expect(text).toContain("deploy 1.202608.13");
    expect(text).toContain("Running");
    // A running task shows what it is running; a finished one shows how it
    // ended, once the history is on screen.
    expect(text).toContain("bash scripts/deploy.sh");
    expect(text).toContain("7m 1s");

    const row = host.querySelector<HTMLButtonElement>(".background-task-0");
    row?.click();
    expect(opened).toEqual(["b96da5ec8"]);

    host.querySelector<HTMLButtonElement>(".activity-history-toggle")?.click();
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(host.textContent).toContain("exit 0");
  });

  it("reports a running record whose process is gone as lost, not running", async () => {
    // Nothing corrects a task file when the machine reboots under it, so a
    // stale "running" would spin forever in the strip.
    const host = await mountTasks([
      { id: "dead", name: "old deploy", command: "x", status: "lost", startedAt: "2026-08-01T00:00:00.000Z", durationMs: 10_000, bytesWritten: 0, hasOutput: false },
    ]);

    // A lost record is not live work, so it waits with the rest of the history.
    expect(host.textContent).toContain("Nothing running right now");
    host.querySelector<HTMLButtonElement>(".activity-history-toggle")?.click();
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    expect(host.textContent).toContain("Lost");
    expect(host.textContent).not.toContain("Running");
    expect(host.querySelector<HTMLButtonElement>(".background-task-0")?.disabled).toBe(true);
  });
});

describe("activity filters", () => {
  const activity = { rows: [1], runRows: [1, 2], taskRows: [1, 2, 3] };

  // A long chat accumulates dozens of rows of three different kinds; "what are
  // my subagents doing" and "did that build finish" are separate questions.
  it("offers All plus every kind that has rows, with counts", () => {
    expect(activityFilterOptions(activity)).toEqual([
      { id: "all", label: "All", count: 6 },
      { id: "subagents", label: "Subagents", count: 1 },
      { id: "runs", label: "Agent runs", count: 2 },
      { id: "tasks", label: "Tasks", count: 3 },
    ]);
  });

  it("offers no choice when there is only one kind", () => {
    expect(activityFilterOptions({ rows: [], runRows: [], taskRows: [1] })).toEqual([{ id: "tasks", label: "Tasks", count: 1 }]);
    expect(activityFilterOptions({ rows: [], runRows: [], taskRows: [] })).toEqual([]);
  });

  it("falls back to All when the chosen kind has emptied out", () => {
    expect(activityFilterInEffect("runs", activity)).toBe("runs");
    expect(activityFilterInEffect("runs", { rows: [1], runRows: [], taskRows: [] })).toBe("all");
    expect(activityFilterInEffect("all", activity)).toBe("all");
  });
});

describe("activityTabLabel", () => {
  // The number that matters is what is live: a chat that has run forty tasks
  // and is running two should say two.
  it("counts live work when there is any, and the history when there is not", () => {
    expect(activityTabLabel({ active: 2, total: 42 })).toBe("Activity · 2 running");
    expect(activityTabLabel({ active: 0, total: 42 })).toBe("Activity (42)");
  });
});

describe("isActiveActivityStatus", () => {
  it("counts only work that is happening now", () => {
    expect(["working", "running"].every(isActiveActivityStatus)).toBe(true);
    expect(["idle", "done", "failed", "unknown", "lost"].some(isActiveActivityStatus)).toBe(false);
  });
});

describe("orderActivityEntries", () => {
  // Ordering reads only kind, status and start time; the row payload is
  // whatever that kind carries, so a real one keeps the fixture honest.
  function entry(kind: "runs", status: string, startedAt?: string): ActivityListEntry;
  function entry(kind: "subagents" | "tasks", status: string, startedAt?: string): ActivityListEntry;
  function entry(kind: "subagents" | "runs" | "tasks", status: string, startedAt?: string): ActivityListEntry {
    const started = startedAt === undefined ? {} : { startedAt };
    if (kind === "subagents") {
      const [row] = subagentRows([{ sessionId: "01a0child-0001-0000-000000000001", cwd: "/repo", status: "working" }]);
      if (row === undefined) throw new Error("expected a subagent row");
      return { kind, index: 0, status, ...started, row };
    }
    if (kind === "runs") {
      const [row] = subagentRunRows([{ runId: "r", agent: "scout", status: "running", elapsedMs: 0, startedAt: startedAt ?? "", hasOutput: false }]);
      if (row === undefined) throw new Error("expected a run row");
      return { kind, index: 0, status, ...started, row };
    }
    const [row] = backgroundTaskRows([{ id: "t", name: "task", command: "x", status: "completed", startedAt: startedAt ?? "", bytesWritten: 0, hasOutput: false }]);
    if (row === undefined) throw new Error("expected a task row");
    return { kind, index: 0, status, ...started, row };
  }

  // Grouping by kind put a finished task above a running subagent purely
  // because of which list it came from.
  it("puts live work first, whatever kind it is", () => {
    const ordered = orderActivityEntries([
      entry("tasks", "done", "2026-08-24T10:00:00.000Z"),
      entry("subagents", "working"),
      entry("runs", "running", "2026-08-24T09:00:00.000Z"),
    ]);
    // Both live rows come before the finished one; a subagent session carries
    // no start time of its own, so it sits behind the run that does.
    expect(ordered.map((item) => item.status)).toEqual(["running", "working", "done"]);
  });

  it("orders finished work by most recent", () => {
    const ordered = orderActivityEntries([
      entry("tasks", "done", "2026-08-24T09:00:00.000Z"),
      entry("runs", "done", "2026-08-24T11:00:00.000Z"),
      entry("tasks", "failed", "2026-08-24T10:00:00.000Z"),
    ]);
    expect(ordered.map((item) => item.startedAt)).toEqual([
      "2026-08-24T11:00:00.000Z",
      "2026-08-24T10:00:00.000Z",
      "2026-08-24T09:00:00.000Z",
    ]);
  });
});

describe("subagentStatusLabel", () => {
  it("speaks in the same voice as the other activity rows", () => {
    // Agent-run rows report Running / Done / Failed, so passing a subagent's
    // raw status through put "Working" directly above "idle" in one column.
    expect(subagentStatusLabel("working")).toBe("Working");
    expect(subagentStatusLabel("idle")).toBe("Idle");
    expect(subagentStatusLabel("error")).toBe("Error");
  });

  it("names an absent status rather than rendering a blank cell", () => {
    expect(subagentStatusLabel("")).toBe("Unknown");
  });
});
