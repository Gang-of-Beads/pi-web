import { describe, expect, it } from "vitest";
import type { SessionStatus } from "./apiTypes";
import { sessionActivityCategory } from "./sessionActivityState";

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

describe("a session parked on an extension dialog", () => {
  it("is asking, in the rows as well as in the dock", () => {
    const dialog = { dialogId: "d1", kind: "confirm" as const, title: "Update pi?", askedAt: "", runScoped: true };
    // Session rows read this classifier; leaving dialogs out of it meant the
    // one session actually blocked on the user looked like the idle one.
    expect(sessionActivityCategory(status({ pendingDialogs: [dialog] }), undefined)).toBe("asking");
    expect(sessionActivityCategory(status({ pendingDialogs: [] }), undefined)).toBe("idle");
  });
});
