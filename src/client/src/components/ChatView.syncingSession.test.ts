import { describe, expect, it } from "vitest";
import { ChatView } from "./ChatView.js";
import type { SessionStatus } from "../api.js";

/**
 * A session the machine has not written yet is not an empty session.
 *
 * Both have no messages, so both used to render "This session is empty. Send a
 * message to start it." - an invitation into somewhere that does not exist
 * yet, next to a daemon that would answer "Session not found" if you took it
 * up. Only a session positively reported as not persisted says it is still
 * arriving; unknown keeps the invitation, because nobody has established which
 * it is and the invitation is the safer of the two readings.
 */

function status(patch: { sessionId: string; persisted?: boolean }): SessionStatus {
  return {
    sessionId: patch.sessionId,
    ...(patch.persisted === undefined ? {} : { persisted: patch.persisted }),
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    messageCount: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  };
}

function emptyStateText(view: ChatView): string {
  const render: unknown = Reflect.get(view, "renderEmptySession");
  if (typeof render !== "function") throw new Error("Could not reach ChatView.renderEmptySession");
  return JSON.stringify(render.call(view));
}

function viewWith(sessionId: string, sessionStatus: SessionStatus | undefined): ChatView {
  const view = new ChatView();
  if (!Reflect.set(view, "sessionId", sessionId)) throw new Error("Could not set ChatView.sessionId");
  if (!Reflect.set(view, "status", sessionStatus)) throw new Error("Could not set ChatView.status");
  return view;
}

describe("an empty transcript", () => {
  it("says a session that is not written yet is still syncing", () => {
    expect(emptyStateText(viewWith("s1", status({ sessionId: "s1", persisted: false })))).toContain("Still syncing");
  });

  it("invites a first message into a session that is genuinely empty", () => {
    expect(emptyStateText(viewWith("s1", status({ sessionId: "s1", persisted: true })))).toContain("empty");
  });

  /** No status is no evidence; the invitation stands rather than a claim. */
  it("invites a first message when nothing is known", () => {
    expect(emptyStateText(viewWith("s1", undefined))).toContain("empty");
  });

  /**
   * The retained-data rule: a status belonging to another session must not
   * describe this one.
   */
  it("ignores a status that belongs to a different session", () => {
    expect(emptyStateText(viewWith("s1", status({ sessionId: "other", persisted: false })))).toContain("empty");
  });
});
