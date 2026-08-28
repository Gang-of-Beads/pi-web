// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { SessionActivity, SessionInfo, SessionStatus } from "../api";
import { SessionList } from "./SessionList";
import { sessionRowIndicator } from "./sessionRowIndicator";

afterEach(() => { document.body.replaceChildren(); });

/**
 * A session row used to compose two marks: the state badge drew the work
 * state and unread drew a ring around it, so a row could carry two rings in
 * the slot meant for one mark. The arbiter in sessionRowIndicator.ts replaced
 * composition with a ranking; these tests pin the ranking for every
 * simultaneous (stateKind, unread) combination and assert that exactly one
 * indicator element — never two — reaches the row.
 */
describe("one indicator per session row", () => {
  it("ranks asking above working and above unread", async () => {
    await expectSingleIndicator({ status: statusWithAsk(), unread: true }, "asking");
    // An ask while the session is still streaming is asking: the answer is
    // what unblocks the reader, the streaming is what happens after it.
    await expectSingleIndicator({ status: askWhileStreamingStatus(), unread: true }, "asking");
    await expectSingleIndicator({ status: statusWithAsk(), unread: false }, "asking");
  });

  it("ranks running (working or sending) above unread", async () => {
    await expectSingleIndicator({ status: streamingStatus(), unread: true }, "running");
    await expectSingleIndicator({ activity: activeActivity(), unread: true }, "running");
    await expectSingleIndicator({ sending: true, unread: true }, "running");
    await expectSingleIndicator({ status: streamingStatus(), unread: false }, "running");
  });

  it("renders the purple unread dot when unread is the strongest signal", async () => {
    // idle, error and background all keep their marks when they are the only
    // signal; with unread present, unread wins. The error/background/idle
    // below-unread placement is the one extension the chosen priority chain
    // did not name (the chain names asking > running > unread > nothing).
    await expectSingleIndicator({ unread: true }, "unread");
    await expectSingleIndicator({ status: idleStatus(), unread: true }, "unread");
    await expectSingleIndicator({ activity: errorActivity(), unread: true }, "unread");
    await expectSingleIndicator({ status: backgroundStatus(), unread: true }, "unread");
  });

  it("keeps error, background and idle marks when nothing outranks them", async () => {
    await expectSingleIndicator({ activity: errorActivity(), unread: false }, "error");
    await expectSingleIndicator({ status: backgroundStatus(), unread: false }, "background");
    await expectSingleIndicator({ status: idleStatus(), unread: false }, "idle");
  });

  it("shows nothing when the session is read and idle or has no signal", async () => {
    await expectSingleIndicator({ status: idleStatus(), unread: false }, "idle");
    await expectSingleIndicator({ unread: false }, undefined);
  });

  it("labels the marks a reader can tell apart", () => {
    expect(sessionRowIndicator(undefined, true)?.label).toBe("Unread session activity");
    expect(sessionRowIndicator("asking", true)?.label).toBe("Waiting for your answer");
    expect(sessionRowIndicator("working", false)?.label).toBe("Session is working");
    expect(sessionRowIndicator("sending", false)?.label).toBe("Sending message");
    expect(sessionRowIndicator(undefined, false)).toBeUndefined();
  });
});

interface RowSignals {
  status?: SessionStatus;
  activity?: SessionActivity;
  sending?: boolean;
  unread?: boolean;
}

async function expectSingleIndicator(signals: RowSignals, expectedKind: "asking" | "running" | "unread" | "error" | "background" | "idle" | undefined): Promise<void> {
  const list = await renderRow(signals);
  const row = list.shadowRoot?.querySelector(".action-row");
  if (row === null || row === undefined) throw new Error("Expected a rendered session row");

  const marks = [...row.querySelectorAll(".session-state, .unread-ring")];
  if (expectedKind === undefined) {
    expect(marks, `expected no indicator, found ${String(marks.length)}`).toHaveLength(0);
    return;
  }
  expect(marks, `expected exactly one indicator for ${JSON.stringify(signals)}, found ${String(marks.length)}`).toHaveLength(1);
  const mark = marks[0];
  if (mark === undefined) throw new Error("Expected one indicator element");
  if (expectedKind === "running") {
    // Running is the three bouncing dots: the container carries no state class
    // of its own, the dots do the work.
    expect(mark.classList.contains("running")).toBe(true);
    expect(mark.querySelectorAll(".state-dot")).toHaveLength(3);
    expect(mark.getAttribute("aria-label")).toBe(signals.sending === true ? "Sending message" : "Session is working");
    return;
  }
  expect(mark.classList.contains(expectedKind)).toBe(true);
  if (expectedKind === "unread") expect(mark.getAttribute("aria-label")).toBe("Unread session activity");
  if (expectedKind === "asking") expect(mark.getAttribute("aria-label")).toBe("Waiting for your answer");
}

async function renderRow(signals: RowSignals): Promise<SessionList> {
  const only = session("s1");
  const list = new SessionList();
  list.sessions = [only];
  list.statuses = signals.status === undefined ? {} : { [only.id]: signals.status };
  list.activities = signals.activity === undefined ? {} : { [only.id]: signals.activity };
  list.sending = signals.sending === true ? { [only.id]: true } : {};
  list.unreadSessionIds = signals.unread === true ? new Set([only.id]) : new Set();
  document.body.append(list);
  await list.updateComplete;
  return list;
}

function session(id: string): SessionInfo {
  return {
    id, name: id, path: `/s/${id}.jsonl`, cwd: "/w",
    created: "2026-08-26T00:00:00.000Z", modified: "2026-08-26T00:00:00.000Z",
    messageCount: 3, firstMessage: "",
  };
}

function idleStatus(): SessionStatus {
  return { sessionId: "s1", persisted: true, isStreaming: false, isCompacting: false, isBashRunning: false, pendingMessageCount: 0, queuedMessages: [], tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 };
}

function streamingStatus(): SessionStatus {
  return { ...idleStatus(), isStreaming: true };
}

function backgroundStatus(): SessionStatus {
  return { ...idleStatus(), backgroundRunCount: 2 };
}

function statusWithAsk(): SessionStatus {
  return { ...idleStatus(), pendingAsk: { askId: "a", askedAt: "now", questions: [] } };
}

function askWhileStreamingStatus(): SessionStatus {
  return { ...streamingStatus(), pendingAsk: { askId: "a", askedAt: "now", questions: [] } };
}

function activeActivity(): SessionActivity {
  return { sessionId: "s1", phase: "active", label: "running tool", at: "now" };
}

function errorActivity(): SessionActivity {
  return { sessionId: "s1", phase: "error", label: "model error", at: "now" };
}
