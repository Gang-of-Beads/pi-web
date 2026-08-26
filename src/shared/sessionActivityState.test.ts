import { describe, expect, it } from "vitest";
import type { SessionStatus } from "./apiTypes";
import { sessionActivityCategory, turnEndedUnanswered } from "./sessionActivityState";

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

describe("a turn that ended without the model answering", () => {
  /**
   * The loop this exists for: a tool ran, returned successfully, and the run
   * ended there. No assistant message was recorded, no error was recorded, and
   * every log line was a 200. The session showed "idle", which is what it
   * shows when a run finished normally, so the only visible difference between
   * "done" and "the turn vanished" was that nothing had been answered.
   *
   * A recorded tool result with no assistant reply after it is the observable
   * form of "the model still owes a response".
   */
  it("is stalled, not idle, when the last thing recorded is a tool result", () => {
    expect(turnEndedUnanswered([
      { role: "user" },
      { role: "assistant" },
      { role: "toolResult" },
    ])).toBe(true);
  });

  // The raw records say `toolResult`; the client's messages arrive split by the
  // tool that produced them. A rule that knows only one vocabulary silently
  // never fires on the surface that shows it.
  it("recognises tool output under the client's role names too", () => {
    for (const role of ["tool", "bash", "skill"]) {
      expect(turnEndedUnanswered([{ role: "assistant" }, { role }])).toBe(true);
    }
  });

  it("is not stalled when the assistant replied after the tool result", () => {
    expect(turnEndedUnanswered([
      { role: "assistant" },
      { role: "toolResult" },
      { role: "assistant" },
    ])).toBe(false);
  });

  it("is not stalled for an empty or user-ended transcript", () => {
    expect(turnEndedUnanswered([])).toBe(false);
    expect(turnEndedUnanswered([{ role: "assistant" }, { role: "user" }])).toBe(false);
  });

  it("reports stalled ahead of idle, and never over real work", () => {
    const tail = [{ role: "toolResult" as const }];
    expect(sessionActivityCategory(status(), undefined, tail)).toBe("stalled");
    // A streaming session owes nothing yet; the tool result is simply the most
    // recent record so far.
    expect(sessionActivityCategory(status({ isStreaming: true }), undefined, tail)).toBe("working");
  });
});
