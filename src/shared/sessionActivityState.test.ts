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

describe("a session whose turn ended while its children run on", () => {
  const activity = { sessionId: "s", phase: "idle" as const, label: "idle", at: "" };

  it("is background, not idle", () => {
    // The chat says "idle · 1 background run"; the rows said nothing at all,
    // because neither status nor activity carried the count.
    expect(sessionActivityCategory(status({ backgroundRunCount: 1 }), activity)).toBe("background");
    expect(sessionActivityCategory(status({ backgroundRunCount: 0 }), activity)).toBe("idle");
    expect(sessionActivityCategory(status(), activity)).toBe("idle");
  });

  it("still reports the work the user is actually blocked on", () => {
    // Background is the weakest signal there is: it must never hide an error,
    // a question, or a turn that is genuinely still running.
    expect(sessionActivityCategory(status({ backgroundRunCount: 2, isStreaming: true }), activity)).toBe("working");
    expect(sessionActivityCategory(status({ backgroundRunCount: 2 }), { ...activity, phase: "error" })).toBe("error");
    const dialog = { dialogId: "d1", kind: "confirm" as const, title: "?", askedAt: "", runScoped: true };
    expect(sessionActivityCategory(status({ backgroundRunCount: 2, pendingDialogs: [dialog] }), activity)).toBe("asking");
  });
});


