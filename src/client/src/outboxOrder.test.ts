import { describe, expect, it } from "vitest";
import { acceptSubmission, nextSequence, nextToSend, type OrderedEntry } from "./outboxOrder.js";

/**
 * Two messages sent a second apart, the first one's request stalling, and the
 * instructions arrive backwards. Identity stops a message being drawn twice; it
 * does nothing about order.
 */

function entry(id: string, seq: number, state: OrderedEntry["state"] = "outbox"): OrderedEntry {
  return { id, seq, state };
}

describe("what the outbox sends next", () => {
  it("sends the lowest unsent sequence", () => {
    expect(nextToSend([entry("b", 2), entry("a", 1)])).toEqual({ action: "send", id: "a", seq: 1 });
  });

  /** One at a time: parallel drains are how a retry lands after a later send. */
  it("waits while an attempt is in flight", () => {
    expect(nextToSend([entry("a", 1, "inFlight"), entry("b", 2)])).toEqual({ action: "wait", reason: "in-flight" });
  });

  /** An unanswered entry is still in flight, so it holds the line. */
  it("does not skip past a message that has not been answered", () => {
    expect(nextToSend([entry("a", 1, "inFlight"), entry("b", 2), entry("c", 3)]).action).toBe("wait");
  });

  it("moves on once the head is accepted", () => {
    expect(nextToSend([entry("a", 1, "accepted"), entry("b", 2)])).toEqual({ action: "send", id: "b", seq: 2 });
  });

  it("moves on when the head was refused", () => {
    expect(nextToSend([entry("a", 1, "refused"), entry("b", 2)])).toEqual({ action: "send", id: "b", seq: 2 });
  });

  it("waits when there is nothing left", () => {
    expect(nextToSend([entry("a", 1, "accepted")])).toEqual({ action: "wait", reason: "nothing-to-send" });
  });
});

describe("assigning the next sequence", () => {
  it("continues past the highest the outbox holds", () => {
    expect(nextSequence([entry("a", 4), entry("b", 7)], 0)).toBe(8);
  });

  /**
   * Entries leave as they settle, so counting them would re-issue a sequence a
   * still-unanswered message is using.
   */
  it("continues past sequences that have already left the outbox", () => {
    expect(nextSequence([], 12)).toBe(13);
  });
});

describe("what the daemon does with a submission", () => {
  it("accepts the next one in line", () => {
    expect(acceptSubmission(4, 5)).toEqual({ action: "accept", seq: 5 });
  });

  /** The retry contract: a repeat is answered, not run again. */
  it("replays the original outcome for something already accepted", () => {
    expect(acceptSubmission(5, 5)).toEqual({ action: "replay-outcome", seq: 5 });
    expect(acceptSubmission(5, 3)).toEqual({ action: "replay-outcome", seq: 3 });
  });

  /** Acting on a later message while an earlier one is missing applies instructions out of order. */
  it("holds a submission that has left a gap behind it", () => {
    expect(acceptSubmission(4, 6)).toEqual({ action: "hold", expected: 5, received: 6 });
  });

  it("accepts the first message of a session", () => {
    expect(acceptSubmission(0, 1)).toEqual({ action: "accept", seq: 1 });
  });
});
