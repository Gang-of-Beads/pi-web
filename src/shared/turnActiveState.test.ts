import { describe, expect, it } from "vitest";
import { sessionActivityCategory } from "./sessionActivityState.js";
import { isSessionActive } from "./activity.js";
import type { SessionStatus } from "./apiTypes.js";

const between: SessionStatus = {
  sessionId: "session-1",
  model: { provider: "anthropic", id: "claude-opus-5" },
  isStreaming: false,
  isBashRunning: false,
  isCompacting: false,
  pendingMessageCount: 0,
  queuedMessages: [],
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  cost: 0,
};

/**
 * Between two tool calls the model has stopped emitting and the next tool has
 * not started, so streaming, bash and compaction are all false. Read from those
 * alone a session mid-turn says "Session is done".
 */
describe("a session between tool calls is still working", () => {
  it("does not call a session with an active turn idle", () => {
    expect(sessionActivityCategory({ ...between, turnActive: true }, undefined)).toBe("working");
  });

  it("still calls a session with no turn idle", () => {
    expect(sessionActivityCategory(between, undefined)).toBe("idle");
  });

  it("counts an active turn as activity", () => {
    expect(isSessionActive({ ...between, turnActive: true })).toBe(true);
    expect(isSessionActive(between)).toBe(false);
  });

  it("lets an ask outrank an active turn, because the reader is the one holding it", () => {
    const asking = { ...between, turnActive: true, pendingAsk: { askId: "a", askedAt: "2026-09-03T00:00:00.000Z", questions: [], runScoped: false } };
    expect(sessionActivityCategory(asking, undefined)).toBe("asking");
  });

  it("keeps error ahead of an active turn", () => {
    expect(sessionActivityCategory({ ...between, turnActive: true }, { sessionId: "session-1", at: "2026-09-03T00:00:00.000Z", phase: "error", label: "boom" })).toBe("error");
  });
});
