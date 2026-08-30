// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionActivity, SessionStatus } from "../../../shared/apiTypes";
import { activityDockLabel, backgroundTaskRows, isActiveActivityStatus, isFinishedActivityStatus, subagentRunRows, backgroundWorkLabel, ChatView, LONG_TURN_AFTER_MS, turnElapsedLabel } from "./ChatView";

function status(over: Partial<SessionStatus>): SessionStatus {
  return {
    sessionId: "s",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    ...over,
  };
}

function activity(phase: SessionActivity["phase"], label = "Working"): SessionActivity {
  return { sessionId: "s", phase, label, at: "" };
}

async function dockWith(status: SessionStatus | undefined, activity: SessionActivity | undefined): Promise<{ dots: NodeListOf<Element>; dot: Element | null; className: string; text: string }> {
  const view = new ChatView();
  view.sessionId = "s";
  if (status !== undefined) view.status = status;
  if (activity !== undefined) view.activity = activity;
  document.body.append(view);
  await view.updateComplete;
  const host = view.renderRoot;
  const dock = host.querySelector(".activity-dock");
  return {
    dots: host.querySelectorAll(".state-dot"),
    dot: host.querySelector(".activity-dock .dot"),
    className: dock?.getAttribute("class") ?? "",
    text: host.querySelector(".activity-text")?.textContent ?? "",
  };
}


/**
 * The 64px bottom padding was the floating activity dock's reservation: both
 * arrived in the commit that added the dock, when it was absolutely positioned
 * over the scroller's bottom edge. The dock is an in-flow row below the
 * scroller now, with its own margin, so the reservation was dead weight:
 * measured at 393x850 against the built bundle
 * (scripts/probe-chatview-press-geometry.mjs) the last message sat 80px above
 * the dock - the message rhythm's own 16px margin plus 64px of reserved
 * nothing. The transcript ends with the room it had before the dock existed:
 * one --pi-space-7 of padding on top of the message margin, i.e. 32px from the
 * last message to the dock. happy-dom has no layout, so this pins the
 * declaration; the probe measures the geometry.
 */
describe("the room the transcript keeps below its last message", () => {
  it("ends with the pre-dock edge, not the floating dock's reservation", () => {
    const sheet = String(ChatView.styles);
    const chat = /\.chat\s*\{[^}]*\}/u.exec(sheet)?.[0] ?? "";

    expect(chat).not.toBe("");
    expect(chat).toMatch(/padding:\s*26px var\(--pi-chat-gutter\) var\(--pi-space-7\)/u);
    expect(chat).not.toMatch(/64px/u);
  });
});

describe("ChatView activity dock states", () => {
  it("shows three bouncing dots while streaming", async () => {
    const dock = await dockWith(status({ isStreaming: true }), activity("active"));
    expect(dock.className).toContain("working");
    expect(dock.dots.length).toBe(3);
  });

  it("shows a static green dot when idle", async () => {
    const dock = await dockWith(status({}), activity("idle"));
    expect(dock.className).toContain("idle");
    expect(dock.dots.length).toBe(0);
    expect(dock.dot).not.toBeNull();
  });

  it("shows an amber dot and waiting text while an ask is open", async () => {
    const dock = await dockWith(status({ pendingAsk: { askId: "a", askedAt: "", questions: [] } }), activity("idle"));
    expect(dock.className).toContain("asking");
    expect(dock.dots.length).toBe(0);
    expect(dock.dot).not.toBeNull();
  });

  it("shows an error state when the activity phase errored", async () => {
    const dock = await dockWith(status({}), activity("error", "model"));
    expect(dock.className).toContain("error");
  });

  it("shows three dots with sending text while a prompt uploads", async () => {
    const view = new ChatView();
    view.sessionId = "s";
    view.isSendingPrompt = true;
    document.body.append(view);
    await view.updateComplete;
    const host = view.renderRoot;
    expect(host.querySelectorAll(".state-dot").length).toBe(3);
    expect(host.querySelector(".activity-text")?.textContent).toContain("Sending");
  });
});
describe("backgroundWorkLabel", () => {
  // "idle" alone is a lie while this chat's children are still running: the
  // assistant's turn is over, the work is not.
  it("names the live background work that outlives the turn", () => {
    expect(backgroundWorkLabel({ rows: [], runRows: [{ status: "running" }], taskRows: [] })).toBe("idle · 1 background run");
    expect(backgroundWorkLabel({ rows: [{ status: "working" }], runRows: [{ status: "running" }], taskRows: [{ status: "running" }] }))
      .toBe("idle · 3 background runs");
  });

  it("leaves a quiet session alone", () => {
    expect(backgroundWorkLabel({ rows: [], runRows: [{ status: "done" }], taskRows: [{ status: "failed" }] })).toBeUndefined();
    expect(backgroundWorkLabel(undefined)).toBeUndefined();
  });
});

describe("background work dock is a control", () => {
  // Naming live background work and then ignoring a tap on it is a dead end;
  // the drawer that lists it is one control away.
  it("opens the activity drawer on the running work it names", async () => {
    const view = new ChatView();
    view.sessionId = "s";
    view.status = status({});
    view.activity = activity("idle");
    view.subagentRuns = [{ runId: "r1", agent: "scout", status: "running", elapsedMs: 1000, startedAt: "2026-08-24T10:00:00.000Z", hasOutput: false }];
    document.body.append(view);
    await view.updateComplete;

    const dock = view.renderRoot.querySelector<HTMLButtonElement>(".activity-dock.background");
    expect(dock?.textContent).toContain("1 background run");

    dock?.click();
    await view.updateComplete;

    expect(view.renderRoot.querySelector<HTMLElement>(".drawer-body")?.hidden).toBe(false);
    expect(view.renderRoot.querySelector(".drawer-tab-activity")?.getAttribute("aria-selected")).toBe("true");
    expect(view.renderRoot.querySelectorAll(".subagent-row").length).toBe(1);
  });
});

describe("turnElapsedLabel", () => {
  const started = 1_000_000;

  // A turn held open by a background process nobody can see reads as "still
  // thinking" all night, and every message typed into it queues behind it.
  it("stays quiet for the first seconds, then reports the age of the turn", () => {
    expect(turnElapsedLabel(started, started + 2_000)).toBeUndefined();
    expect(turnElapsedLabel(started, started + 42_000)).toEqual({ text: "42s", long: false });
    expect(turnElapsedLabel(started, started + 125_000)).toEqual({ text: "2m 5s", long: false });
  });

  it("flags a turn that has run past the point of plausibility", () => {
    expect(turnElapsedLabel(started, started + LONG_TURN_AFTER_MS)).toMatchObject({ long: true });
    expect(turnElapsedLabel(started, started + 12 * 60 * 60 * 1000)).toEqual({ text: "12h 0m", long: true });
  });

  it("reports nothing when no turn is running", () => {
    expect(turnElapsedLabel(undefined, started)).toBeUndefined();
  });
});

describe("elapsed turn time", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("is shown but never announced", async () => {
    vi.useFakeTimers();
    const view = new ChatView();
    view.sessionId = "s";
    view.status = status({ isStreaming: true });
    view.activity = { sessionId: "s", phase: "active", label: "Working", at: "" };
    document.body.append(view);
    await view.updateComplete;
    // The label deliberately waits out the first seconds of a turn, so the
    // clock has to run before there is anything to assert about.
    await vi.advanceTimersByTimeAsync(6000);
    await view.updateComplete;
    const host = view.renderRoot;
    const dock = host.querySelector(".activity-dock");
    const elapsed = host.querySelector(".activity-elapsed");
    expect(elapsed).not.toBeNull();
    // The dock is a polite live region and the counter reticks every second,
    // so announcing it would read the clock aloud once per second for the
    // whole turn, burying everything else the region exists to report.
    expect(dock?.getAttribute("aria-live")).toBe("polite");
    expect(elapsed?.getAttribute("aria-hidden")).toBe("true");
    view.remove();
  });
});

describe("a question the user has not answered", () => {
  it("marks the dock as asking for an extension dialog, not only for an ask_user set", async () => {
    const dialog = { dialogId: "d1", kind: "confirm" as const, title: "Update pi 0.84.2 → 0.84.3?", askedAt: "", runScoped: true };
    const dock = await dockWith(status({ pendingDialogs: [dialog] }), activity("idle", "idle"));

    // A blocking decision with a countdown is the one thing in the app most
    // deserving of "waiting for you"; reporting it as idle is how a session
    // that is holding still for an answer looks like a session with nothing
    // to do.
    expect(dock.className).toContain("asking");
  });

  /**
   * The badge and the word were worked out separately and disagreed: the dock
   * was painted "waiting for you" and captioned "idle". Measured on the running
   * app, that is what a run parked on an extension dialog looked like - a
   * marker saying nothing was happening, on a session that could not move
   * until someone answered.
   */
  it("says it is waiting rather than saying it is idle", async () => {
    const dialog = { dialogId: "d1", kind: "confirm" as const, title: "Update pi 0.84.2 → 0.84.3?", askedAt: "", runScoped: true };

    const dock = await dockWith(status({ pendingDialogs: [dialog] }), activity("idle", "idle"));

    expect(dock.text).not.toBe("idle");
    expect(dock.text.toLowerCase()).toContain("waiting");
  });

  it("leaves every other state's words alone", () => {
    expect(activityDockLabel("idle", "idle", "idle")).toBe("idle");
    expect(activityDockLabel("working", "running", "reading a file")).toBe("reading a file");
    expect(activityDockLabel("asking", "compacting", "compacting")).toBe("compacting");
  });

  /**
   * The words are whatever the activity feed last called the turn, so a feed
   * that labels the idle state anything but the bare word would have slipped
   * past a check written against the words.
   */
  it("reads the state rather than the words drawn from it", () => {
    expect(activityDockLabel("asking", "idle", "waiting on the model")).toBe("Waiting for your answer");
  });
});

describe("what counts as a failure in the activity summary", () => {
  /**
   * Stopping a background task is something the reader did on purpose. Folding
   * killed tasks in with failed ones made the drawer report dozens of
   * failures for a session where nothing had gone wrong, which is the same
   * mistake as calling a deliberately ended turn an error: a human action
   * reported as a fault teaches the reader to ignore the count.
   *
   * Lost is kept separate too: losing track of a task is not the task failing.
   */
  it("does not call a stopped task a failure", () => {
    const rows = backgroundTaskRows([
      { id: "a", name: "one", status: "killed", startedAt: "", durationMs: 0, command: "true", bytesWritten: 0, hasOutput: false },
      { id: "b", name: "two", status: "failed", startedAt: "", durationMs: 0, command: "true", bytesWritten: 0, hasOutput: false },
      { id: "c", name: "three", status: "completed", startedAt: "", durationMs: 0, command: "true", bytesWritten: 0, hasOutput: false },
    ]);

    expect(rows.map((row) => row.status)).toEqual(["stopped", "failed", "done"]);
  });

  it("says a stopped task was stopped", () => {
    const rows = backgroundTaskRows([{ id: "a", name: "one", status: "killed", startedAt: "", durationMs: 0, command: "true", bytesWritten: 0, hasOutput: false }]);

    expect(rows[0]?.statusLabel).toBe("Stopped");
  });
});

describe("a subagent run whose fate is unknown", () => {
  /**
   * Losing track of a run is the reader losing information, not the run
   * failing. Reporting it as failed put a fault on the board for something
   * nobody had established had gone wrong.
   */
  it("does not call a lost run a failure", () => {
    const rows = subagentRunRows([
      { runId: "r1", status: "lost", elapsedMs: 0, startedAt: "", agent: "reviewer", task: "look", hasOutput: false },
    ]);

    expect(rows[0]?.status).toBe("lost");
    expect(rows[0]?.statusLabel).toBe("Lost");
  });
});



describe("whether a stopped task is over", () => {
  /**
   * A task the reader stopped will not do anything else. Leaving it out of the
   * terminal statuses would have kept it listed as unfinished work forever.
   */
  it("treats a stopped task as finished", () => {
    expect(isFinishedActivityStatus("stopped")).toBe(true);
    expect(isActiveActivityStatus("stopped")).toBe(false);
  });
});

describe("the dock's row cannot vanish mid-stream", () => {
  /**
   * The suspected jitter producer was a beat where streaming had begun but no
   * renderable state existed, collapsing the row. Investigated and NOT
   * REPRODUCED: with a status present, activityState() always answers -
   * compacting, bash, running, queued, or idle - so a live session always has
   * a dock. These pins keep that true; if someone adds an early return that
   * can fire mid-stream, the collapse becomes possible again and this fails.
   */
  it("renders the working dock even before any activity state arrives", async () => {
    const { className } = await dockWith(status({ isStreaming: true }), undefined);
    expect(className).toContain("activity-dock");
    expect(className).toContain("working");
  });

  it("still answers with the idle pill rather than nothing once status exists", async () => {
    const { className } = await dockWith(status({}), undefined);
    expect(className).toContain("idle");
  });

  /**
   * The dock is one row by contract: a label that wraps grows the row and
   * moves the composer, so the text clips to a single line instead.
   */
  it("clips the label to one line so growth cannot change the row height", () => {
    const sheet = String(ChatView.styles);
    expect(sheet).toMatch(/\.activity-text\s*\{[^}]*white-space:\s*nowrap/);
    expect(sheet).toMatch(/\.activity-text\s*\{[^}]*text-overflow:\s*ellipsis/);
  });
});
