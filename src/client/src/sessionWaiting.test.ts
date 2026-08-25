import { describe, expect, it } from "vitest";
import type { PendingExtensionDialog, SessionStatus } from "../../shared/apiTypes";
import { isWaitingForUser } from "./sessionWaiting";

const dialog: PendingExtensionDialog = { dialogId: "d1", kind: "confirm", title: "Update pi?", askedAt: "", runScoped: true };

function status(over: Partial<SessionStatus> = {}): SessionStatus {
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

describe("isWaitingForUser", () => {
  it("counts an extension dialog, not only an ask_user set", () => {
    expect(isWaitingForUser(status({ pendingDialogs: [dialog] }))).toBe(true);
    expect(isWaitingForUser(status({ pendingAsk: { askId: "a", questions: [], askedAt: "" } }))).toBe(true);
  });

  it("is false when nothing is waiting on the user", () => {
    expect(isWaitingForUser(status())).toBe(false);
    // An empty list is the daemon saying "no dialogs", not "a dialog".
    expect(isWaitingForUser(status({ pendingDialogs: [] }))).toBe(false);
    expect(isWaitingForUser(undefined)).toBe(false);
  });

  it("does not confuse the session's own work with waiting for an answer", () => {
    expect(isWaitingForUser(status({ isStreaming: true }))).toBe(false);
  });
});
