// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { SessionBackgroundTaskInfo, SessionSubagentInfo, SessionSubagentRunInfo } from "../../../shared/apiTypes";
import { activityEntryKey, type ActivityStatus, backgroundTaskRows, activityFilterInEffect, activityFilterOptions, activityStripSummary, activityTabLabel, ChatView, subagentStatusLabel, isActiveActivityStatus, isFinishedActivityStatus, orderActivityEntries, type ActivityListEntry, selectedTopDrawerTab, subagentRows, subagentRunDuration, subagentRunRows, topDrawerStartsOpen } from "./ChatView";

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
  it("lists both the working and the resting subagent up front, and opens one on tap", async () => {
    // A subagent has no "done" of its own: it rests at "idle" between turns
    // and can still be resumed. Hiding it under "Show N finished" made a live
    // child vanish, so the active view keeps both rows and only shows the
    // history control when something is truly finished.
    const { host, onOpenSubagent } = await mount(SUBAGENTS);

    const rows = [...host.querySelectorAll(".subagent-row")];
    expect(rows.length).toBe(2);
    expect(rows[0]?.getAttribute("aria-label")).toBe("Working subagent 00000001");
    expect(rows[1]?.getAttribute("aria-label")).toBe("Idle subagent 00000002");
    // The strip still counts only work happening right now, not resting children.
    expect(host.textContent).toContain("Activity \u00b7 1 running");
    expect(host.querySelector(".activity-history-toggle")).toBeNull();

    rows[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onOpenSubagent).toHaveBeenCalledExactlyOnceWith(SUBAGENTS[0]);
  });

  it("stays folded for finished work", async () => {
    const host = await mountTasks([
      { id: "a", name: "Verify suite", command: "npm run verify", status: "completed", startedAt: "2026-08-21T19:00:00.000Z", durationMs: 55_000, exitCode: 0, bytesWritten: 12, hasOutput: true },
      { id: "b", name: "Install deps", command: "npm ci", status: "completed", startedAt: "2026-08-21T19:00:00.000Z", durationMs: 5_000, exitCode: 0, bytesWritten: 12, hasOutput: true },
    ]);

    expect(host.querySelector<HTMLElement>(".drawer-body")?.hidden).toBe(true);

    host.querySelector<HTMLButtonElement>(".drawer-toggle")?.click();
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(host.querySelector<HTMLElement>(".drawer-body")?.hidden).toBe(false);
    expect(host.textContent).toContain("Nothing running right now");
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

    // The drawer starts folded now, whatever is running; the header carries
    // the report until the reader asks for the body.
    expect(host.querySelector(".drawer-toggle")?.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector<HTMLElement>(".drawer-body")?.hidden).toBe(true);
    expect(host.textContent).toContain("1 running");

    host.querySelector<HTMLButtonElement>(".drawer-toggle")?.click();
    await view.updateComplete;
    expect(host.querySelector(".drawer-toggle")?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector<HTMLElement>(".drawer-body")?.hidden).toBe(false);

    host.querySelector<HTMLButtonElement>(".drawer-toggle")?.click();
    await view.updateComplete;
    // Back where it started: folded.
    expect(host.querySelector<HTMLElement>(".drawer-body")?.hidden).toBe(true);
  });
});

describe("topDrawerStartsOpen", () => {
  // The complaint this answers: two finished background tasks covered a third
  // of a phone screen and could not be closed.
  it("stays folded when everything is finished", () => {
    expect(topDrawerStartsOpen()).toBe(false);
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
  it("reports that work is running and that some of it failed", () => {
    expect(activityStripSummary(["working", "running", "failed", "idle", "done"])).toEqual({ working: true, failed: true });
  });

  it("reports a quiet strip as neither working nor failed", () => {
    expect(activityStripSummary(["done", "done"])).toEqual({ working: false, failed: false });
    expect(activityStripSummary([])).toEqual({ working: false, failed: false });
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
  /**
   * A count on a tab reads as work waiting for you. Showing the size of the
   * history put "228" next to a session where nothing was running at all.
   */
  it("counts live work, and says nothing when none is live", () => {
    expect(activityTabLabel({ active: 2 })).toBe("Activity · 2 running");
    expect(activityTabLabel({ active: 0 })).toBe("Activity");
  });
});

describe("isActiveActivityStatus", () => {
  it("counts only work that is happening now", () => {
    expect((["working", "running"] as const).every(isActiveActivityStatus)).toBe(true);
    expect((["idle", "done", "failed", "unknown", "lost"] as const).some(isActiveActivityStatus)).toBe(false);
  });
});

describe("isFinishedActivityStatus", () => {
  it("is only the terminal states, so an idle subagent is not finished", () => {
    expect((["done", "failed", "error", "lost"] as const).every(isFinishedActivityStatus)).toBe(true);
    expect((["working", "running", "idle", "unknown"] as const).some(isFinishedActivityStatus)).toBe(false);
  });
});

describe("run status labels", () => {
  // Keyed by the union: adding a status without giving it a word stops
  // compiling here instead of quietly reading "Unknown" in the drawer.
  const EXPECTED: Record<SessionSubagentRunInfo["status"], string> = {
    // Stopped now means the reader stopped it. A run whose tracking was lost
    // is reported as lost: saying "Stopped" claimed an action nobody took.
    running: "Running", done: "Done", failed: "Failed", lost: "Lost", unknown: "Unknown",
  };
  const SUBAGENT_RUN_STATUSES: readonly SessionSubagentRunInfo["status"][] = ["running", "done", "failed", "lost", "unknown"];

  it("gives every status its own word", () => {
    for (const status of Object.keys(EXPECTED)) {
      const run = SUBAGENT_RUN_STATUSES.find((known) => known === status);
      if (run === undefined) throw new Error(`unknown status ${status}`);
      const [row] = subagentRunRows([{ runId: "r", agent: "worker", status: run, elapsedMs: 0, startedAt: "2026-08-25T10:00:00.000Z", hasOutput: false }]);
      expect(row?.statusLabel).toBe(EXPECTED[run]);
    }
  });
});

describe("a run whose tracking was lost", () => {
  it("is named rather than left a mystery, and is not counted as running", () => {
    const [row] = subagentRunRows([{ runId: "r", agent: "worker", status: "lost", elapsedMs: 1000, startedAt: "2026-08-25T10:00:00.000Z", hasOutput: false }]);

    expect(row?.statusLabel).toBe("Lost");
    // Losing track of a run is not the run failing, so it is not filed as one.
    expect(row?.status).toBe("lost");
    expect(isActiveActivityStatus(row?.status ?? "unknown")).toBe(false);
  });
});

describe("orderActivityEntries", () => {
  // Ordering reads only kind, status and start time; the row payload is
  // whatever that kind carries, so a real one keeps the fixture honest.
  function entry(kind: "runs", status: ActivityStatus, startedAt?: string): ActivityListEntry;
  function entry(kind: "subagents" | "tasks", status: ActivityStatus, startedAt?: string): ActivityListEntry;
  function entry(kind: "subagents" | "runs" | "tasks", status: ActivityStatus, startedAt?: string): ActivityListEntry {
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

  // A resting subagent is not finished, so it belongs above work that is,
  // even though it carries no start time to compare on.
  it("keeps a resting subagent above finished work", () => {
    const ordered = orderActivityEntries([
      entry("runs", "done", "2026-08-24T11:00:00.000Z"),
      entry("subagents", "idle"),
    ]);
    expect(ordered.map((item) => item.status)).toEqual(["idle", "done"]);
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

describe("a run says what it is running on", () => {
  /**
   * A fleet of agents on screen gave no way to tell which was on which model,
   * or at what thinking level - the two things that decide what a run costs
   * and how long it takes. The run records it as `provider/model:thinking`.
   */
  it("shows the model and thinking level, and keeps the full id in the title", () => {
    const [row] = subagentRunRows([{
      runId: "r1",
      agent: "opus-design-reviewer-a",
      status: "running",
      elapsedMs: 103_000,
      startedAt: "2026-08-26T10:00:00.000Z",
      model: "anthropic-merchant/claude-opus-5:medium",
      hasOutput: false,
    }]);

    expect(row?.modelLabel).toBe("claude-opus-5 · medium");
    expect(row?.modelTitle).toBe("anthropic-merchant/claude-opus-5:medium");
    expect(row?.ariaLabel).toContain("claude-opus-5 · medium");
  });

  it("says nothing when the run recorded no model", () => {
    const [row] = subagentRunRows([{
      runId: "r2",
      agent: "reviewer",
      status: "done",
      elapsedMs: 1000,
      startedAt: "2026-08-26T10:00:00.000Z",
      hasOutput: true,
    }]);

    expect(row?.modelLabel).toBeUndefined();
  });
});

describe("the goals tab", () => {
  /**
   * On a phone the navigation panel is not on screen, and the goals panel lives
   * inside it, so a running goal was invisible on the device most likely to be
   * asking "what is this session even doing". The drawer above the transcript
   * already carries the session's other cross-cutting context.
   *
   * It is offered only when the workspace has a goal: an empty tab is a tab
   * that teaches the reader to ignore the row it sits in.
   */
  it("is available only when the workspace has goals", () => {
    expect(selectedTopDrawerTab({ activity: false, notifications: false, goals: true }, undefined)).toBe("goals");
    expect(selectedTopDrawerTab({ activity: false, notifications: false, goals: false }, undefined)).not.toBe("goals");
  });

  it("is kept when it is the tab the reader chose", () => {
    expect(selectedTopDrawerTab({ activity: true, notifications: true, goals: true }, "goals")).toBe("goals");
  });

  it("does not steal the drawer from activity or notifications by default", () => {
    // Goals change slowly; work in flight is what a reader opens the drawer for.
    expect(selectedTopDrawerTab({ activity: true, notifications: false, goals: true }, undefined)).toBe("activity");
    expect(selectedTopDrawerTab({ activity: false, notifications: true, goals: true }, undefined)).toBe("notifications");
  });

  it("falls back off a goals tab that has emptied out", () => {
    expect(selectedTopDrawerTab({ activity: true, notifications: false, goals: false }, "goals")).toBe("activity");
  });
});

describe("the drawer opens only when asked", () => {
  /**
   * The drawer opened itself whenever something was running, had failed, or a
   * notification had arrived - which on a busy session is most of the time. It
   * took a fifth of a phone screen from the conversation to report things the
   * collapsed strip already summarises, and the reader had to close it again
   * on every visit. Attention belongs in the strip; taking the screen belongs
   * to the reader.
   */
  it("never opens itself, whatever is happening", () => {
    expect(topDrawerStartsOpen()).toBe(false);
  });
});

describe("the drawer gives the screen back", () => {
  /**
   * The pure rule is worth nothing unless the view drops the expansion. This
   * drives the transition the reader meets: they open the drawer to watch a
   * subagent, and the subagent finishes.
   */
  it("folds a drawer it opened once the work finishes", async () => {
    const { view } = await mount(SUBAGENTS);
    const key: unknown = Reflect.get(view, "topDrawerKey");
    if (typeof key !== "function") throw new Error("expected a drawer key");
    const drawerKey: unknown = Reflect.apply(key, view, []);
    if (typeof drawerKey !== "string") throw new Error("expected a drawer key string");

    Reflect.set(view, "expandedTopDrawerKeys", new Set([drawerKey]));
    Reflect.set(view, "drawerWorkWasRunning", true);

    view.subagents = [];
    view.subagentRuns = [];
    view.backgroundTasks = [];
    await view.updateComplete;

    const expanded: unknown = Reflect.get(view, "expandedTopDrawerKeys");
    if (!(expanded instanceof Set)) throw new Error("expected the expanded keys");
    expect(expanded.has(drawerKey)).toBe(false);
  });
});

/**
 * The owner's second symptom: "it keeps running away - the screen jitters and I
 * have to tap again." The list re-sorts on live status every poll, so a run
 * finishing moves the rows under it. Rendered by position, Lit keeps the DOM at
 * each index and rewrites its text, so the element a finger is travelling
 * towards becomes a different row mid-tap.
 */
describe("rows that move when the list re-sorts", () => {
  function runInfo(runId: string, status: SessionSubagentRunInfo["status"], startedAt: string): SessionSubagentRunInfo {
    return { runId, agent: "worker", status, elapsedMs: 1000, startedAt, hasOutput: false };
  }

  it("keeps a row's element when a finished run pushes it up the list", async () => {
    const view = new ChatView();
    view.sessionId = "parent-1";
    view.subagentRuns = [
      runInfo("run-older", "running", "2026-08-25T10:00:00.000Z"),
      runInfo("run-newer", "running", "2026-08-25T10:05:00.000Z"),
    ];
    document.body.append(view);
    await view.updateComplete;

    const before = [...view.renderRoot.querySelectorAll(".subagent-row")];
    expect(before).toHaveLength(2);
    // The older run sorts second while both are live; it is the one that moves.
    const movingRow = before[1];

    // The newer run finishes, so it sorts below the one still going and the
    // remaining running row moves into the slot the finished one vacated.
    view.subagentRuns = [
      runInfo("run-older", "running", "2026-08-25T10:00:00.000Z"),
      runInfo("run-newer", "done", "2026-08-25T10:05:00.000Z"),
    ];
    await view.updateComplete;
    await view.updateComplete;

    const after = [...view.renderRoot.querySelectorAll(".subagent-row")];
    const stillRunning = after.find((row) => row.className.includes("status-running"));
    // Same element, not a recycled neighbour wearing this row's text.
    expect(stillRunning).toBe(movingRow);
  });

  it("gives every row a key that follows what it is rather than where it sits", () => {
    const [subagentRow] = subagentRows([{ sessionId: "child-1", cwd: "/repo", status: "working" }]);
    const [runRow] = subagentRunRows([runInfo("run-1", "running", "2026-08-25T10:00:00.000Z")]);
    const [taskRow] = backgroundTaskRows([{ id: "task-1", name: "t", command: "x", status: "running", startedAt: "2026-08-25T10:00:00.000Z", bytesWritten: 0, hasOutput: false }]);
    if (subagentRow === undefined || runRow === undefined || taskRow === undefined) throw new Error("expected one row of each kind");

    const keys = [
      activityEntryKey({ kind: "subagents", index: 0, status: "working", row: subagentRow }),
      activityEntryKey({ kind: "runs", index: 9, status: "running", row: runRow }),
      activityEntryKey({ kind: "tasks", index: 4, status: "running", row: taskRow }),
    ];

    expect(keys).toEqual(["subagents:child-1", "runs:run-1", "tasks:task-1"]);
    // Index moves with the sort; the key must not.
    expect(activityEntryKey({ kind: "runs", index: 0, status: "done", row: runRow })).toBe("runs:run-1");
  });
});
