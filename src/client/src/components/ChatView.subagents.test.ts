// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { SessionBackgroundTaskInfo, SessionSubagentInfo, SessionSubagentRunInfo } from "../../../shared/apiTypes";
import { activityStripSummary, ChatView, selectedTopDrawerTab, subagentRows, subagentRunDuration, subagentRunRows, topDrawerStartsOpen } from "./ChatView";

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
  it("shows each subagent with its status and opens one on tap", async () => {
    const { host, onOpenSubagent } = await mount(SUBAGENTS);

    const rows = [...host.querySelectorAll(".subagent-row")];
    expect(rows.length).toBe(2);
    expect(host.textContent).toContain("Activity (2)");
    expect(host.textContent).toContain("Working");
    expect(rows[0]?.getAttribute("aria-label")).toBe("Working subagent 00000001");
    expect(rows[1]?.getAttribute("aria-label")).toBe("idle subagent 00000002");

    rows[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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
    expect(host.textContent).toContain("Work this chat started in the background");
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

async function mountRuns(runs: readonly SessionSubagentRunInfo[]): Promise<{ host: HTMLElement | DocumentFragment; onOpenSubagentRun: ReturnType<typeof vi.fn> }> {
  const view = new ChatView();
  view.sessionId = "parent-1";
  view.subagentRuns = runs;
  const onOpenSubagentRun = vi.fn<(run: SessionSubagentRunInfo) => void>();
  view.onOpenSubagentRun = onOpenSubagentRun;
  document.body.append(view);
  await view.updateComplete;
  return { host: view.renderRoot, onOpenSubagentRun };
}

describe("subagent tool runs", () => {
  it("lists runs with agent, status, elapsed time and current step", async () => {
    // These runs are not sessions, so this strip is the only place they are
    // visible anywhere in the UI.
    const { host } = await mountRuns(RUNS);

    expect(host.textContent).toContain("Activity (2)");
    expect(host.textContent).toContain("scout");
    expect(host.textContent).toContain("Running");
    expect(host.textContent).toContain("42s");
    expect(host.textContent).toContain("bash");
    expect(host.textContent).toContain("review the diff");
  });

  // Every run opens, finished or not: a run with no result file yet falls back
  // to its own transcript, so the row always leads somewhere.
  it("opens both a finished run and one still going", async () => {
    const { host, onOpenSubagentRun } = await mountRuns(RUNS);
    const rows = [...host.querySelectorAll(".subagent-row")];

    rows[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onOpenSubagentRun).toHaveBeenCalledExactlyOnceWith(RUNS[0]);

    rows[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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
      { subagent: SUBAGENTS[1], shortId: "00000002", status: "idle", statusLabel: "idle", cwd: "/repo/.pi/sub", ariaLabel: "idle subagent 00000002" },
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
    expect(text).toContain("Activity (2)");
    expect(text).toContain("deploy 1.202608.13");
    expect(text).toContain("Running");
    // A running task shows what it is running; a finished one shows how it ended.
    expect(text).toContain("bash scripts/deploy.sh");
    expect(text).toContain("exit 0");
    expect(text).toContain("7m 1s");

    const row = host.querySelector<HTMLButtonElement>(".background-task-0");
    row?.click();
    expect(opened).toEqual(["b96da5ec8"]);
  });

  it("reports a running record whose process is gone as lost, not running", async () => {
    // Nothing corrects a task file when the machine reboots under it, so a
    // stale "running" would spin forever in the strip.
    const host = await mountTasks([
      { id: "dead", name: "old deploy", command: "x", status: "lost", startedAt: "2026-08-01T00:00:00.000Z", durationMs: 10_000, bytesWritten: 0, hasOutput: false },
    ]);

    expect(host.textContent).toContain("Lost");
    expect(host.textContent).not.toContain("Running");
    expect(host.querySelector<HTMLButtonElement>(".background-task-0")?.disabled).toBe(true);
  });
});
