// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { SessionActivity, SessionStatus } from "../../../shared/apiTypes";
import { sessionActivityCategory } from "../../../shared/sessionActivityState";

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

function activity(phase: SessionActivity["phase"]): SessionActivity {
  return { sessionId: "s", phase, label: phase, at: "" };
}

describe("sessionActivityCategory", () => {
  it("is error when the activity phase says so, even while something is streaming", () => {
    expect(sessionActivityCategory(status({ isStreaming: true }), activity("error"))).toBe("error");
  });

  it("is asking when a question set waits for the user", () => {
    expect(sessionActivityCategory(status({ isStreaming: true }), undefined)).toBe("working");
    expect(sessionActivityCategory(status({ pendingAsk: { askId: "a", askedAt: "", questions: [] } }), undefined)).toBe("asking");
  });

  it("is working while streaming, compacting, running bash, or queued", () => {
    const cases: Partial<SessionStatus>[] = [
      { isStreaming: true },
      { isCompacting: true },
      { isBashRunning: true },
      { pendingMessageCount: 2 },
    ];
    for (const c of cases) expect(sessionActivityCategory(status(c), undefined)).toBe("working");
  });

  it("is idle when nothing is in flight", () => {
    expect(sessionActivityCategory(status({}), undefined)).toBe("idle");
    expect(sessionActivityCategory(status({}), activity("idle"))).toBe("idle");
  });

  it("reports active activity as working even before status arrives", () => {
    expect(sessionActivityCategory(undefined, activity("active"))).toBe("working");
    expect(sessionActivityCategory(undefined, undefined)).toBe(undefined);
  });
});
