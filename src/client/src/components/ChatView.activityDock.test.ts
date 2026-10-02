// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionActivity, SessionStatus } from "../../../shared/apiTypes";
import { activityDockLabel, ChatView, LONG_TURN_AFTER_MS, turnElapsedLabel } from "./ChatView";

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
    expect(chat).toMatch(/padding:\s*var\(--pi-space-9\) var\(--pi-chat-gutter\) var\(--pi-space-7\)/u);
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
describe("contributed activity notes", () => {
  // "idle" alone is a lie while this chat's children are still running: the
  // assistant's turn is over, the work is not. The shell no longer knows what
  // that work is called; a plugin says so.
  it("shows a plugin's note beside idle, and nothing when no plugin speaks", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const view = new ChatView();
    view.status = status({});
    view.activityNotes = [{ id: "p:n", pluginId: "p", localId: "n", note: () => "2 background runs" }];
    host.append(view);
    await view.updateComplete;
    expect(view.renderRoot.textContent.replace(/\s+/gu, " ")).toContain("idle · 2 background runs");

    view.activityNotes = [{ id: "p:n", pluginId: "p", localId: "n", note: () => undefined }];
    await view.updateComplete;
    expect(view.renderRoot.textContent).not.toContain("background runs");
  });

  it("rides the working line too, so the session reads as one status rather than a dock plus a strip", async () => {
    const view = new ChatView();
    view.status = status({ isStreaming: true });
    view.activity = activity("active", "receiving response");
    view.activityNotes = [{ id: "p:n", pluginId: "p", localId: "n", note: () => "1 background run" }];
    document.body.append(view);
    await view.updateComplete;
    const dock = view.renderRoot.querySelector(".activity-dock");
    expect(dock?.getAttribute("class")).toContain("working");
    expect(dock?.textContent.replace(/\s+/gu, " ")).toContain("receiving response · 1 background run");
    expect(dock?.querySelector(".activity-note")?.textContent).toContain("1 background run");
    expect(view.renderRoot.querySelectorAll(".runs, .runs-chip")).toHaveLength(0);
  });
});

describe("what else is running, while a question holds the reader", () => {
  it("keeps the plugin's note on the dock instead of dropping it with the dock", async () => {
    const view = new ChatView();
    view.sessionId = "s";
    view.status = status({ isStreaming: true });
    view.activity = activity("active", "agent running");
    view.pendingAsk = { askId: "a", askedAt: "", questions: [{ id: "q", question: "Ship?", options: [] }] };
    view.activityNotes = [{ id: "p:n", pluginId: "p", localId: "n", note: () => "3 background runs" }];
    document.body.append(view);
    await view.updateComplete;
    const dock = view.renderRoot.querySelector(".activity-dock");
    expect(dock?.getAttribute("class")).toContain("background");
    expect(dock?.textContent).toContain("3 background runs");
  });

  it("shows no dock at all during a question when no plugin has anything to say", async () => {
    const view = new ChatView();
    view.sessionId = "s";
    view.status = status({ isStreaming: true });
    view.pendingAsk = { askId: "a", askedAt: "", questions: [{ id: "q", question: "Ship?", options: [] }] };
    document.body.append(view);
    await view.updateComplete;
    expect(view.renderRoot.querySelector(".activity-dock")).toBeNull();
  });

  it("lets label and note give way together, and clips the dock, so nothing spills past its border", () => {
    const sheet = String(ChatView.styles);
    expect(sheet).toMatch(/\.activity-note\s*\{[^}]*text-overflow:\s*ellipsis/u);
    expect(sheet).toMatch(/\.activity-dock\s*\{\s*overflow:\s*hidden/u);
  });
});

/**
 * The owner's rule after the chip strip: between the transcript and the composer only the
 * status line itself may appear. A second surface there ("Background · 407 finished")
 * was reported twice; this pins the slot so no contribution can reopen it.
 */
describe("the slot between the transcript and the composer", () => {
  it("holds nothing but the jump-to-newest button and the status line", async () => {
    const view = new ChatView();
    view.sessionId = "s";
    view.status = status({ isStreaming: true });
    view.activity = activity("active", "agent running");
    view.activityNotes = [{ id: "p:n", pluginId: "p", localId: "n", note: () => "407 background runs" }];
    document.body.append(view);
    await view.updateComplete;
    const scroller = view.renderRoot.querySelector(".chat");
    const siblings = [...(scroller?.parentElement?.children ?? [])].filter((node) => node !== scroller);
    const allowed = new Set(["jump-to-bottom", "activity-dock"]);
    const strays = siblings.filter((node) => ![...node.classList].some((name) => allowed.has(name)));
    expect(scroller).not.toBeNull();
    expect(strays.map((node) => node.className)).toEqual([]);
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

/**
 * The status line said the daemon's last event word, so "message queued" stood for a whole turn
 * while the agent worked and two queued messages waited with no reason given (owner, 2026-09-30;
 * B25, state-diagram D3 "The status line narrates").
 */
describe("the status line narrates the agent's step", () => {
  it("says the step, how long it has run, and when the queued messages are read", async () => {
    const since = new Date(Date.now() - 12_000).toISOString();
    const running: SessionActivity = { ...activity("active", "message queued"), step: { kind: "running", tools: [{ id: "c1", name: "bash", target: "sleep 25" }] }, stepSince: since };
    const dock = await dockWith(status({ isStreaming: true, pendingMessageCount: 2, queuedMessages: [{ kind: "steer", text: "a" }, { kind: "steer", text: "b" }] }), running);

    expect(dock.text).toMatch(/^Running bash: sleep 25 · 1[12] s · 2 messages are read when these tools finish$/u);
  });

  it("does not narrate a step on a session that is not working (review of ad83d24b)", async () => {
    const leftover: SessionActivity = { ...activity("idle", "stopped"), step: { kind: "waiting" }, stepSince: new Date().toISOString() };
    const dock = await dockWith(status({}), leftover);

    expect(dock.text).not.toContain("Waiting for the model");
  });

  it("says the activity's own words when no step is published or the session failed", async () => {
    const failed: SessionActivity = { ...activity("error", "extension error"), step: { kind: "thinking" }, stepSince: new Date().toISOString() };
    const old = await dockWith(status({ isStreaming: true }), activity("active", "agent running"));
    document.body.replaceChildren();
    const error = await dockWith(status({ isStreaming: true }), failed);

    expect({ old: old.text, error: error.text }).toEqual({ old: "agent running", error: "extension error" });
  });
});
