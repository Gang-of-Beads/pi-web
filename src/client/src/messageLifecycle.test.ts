import { describe, expect, it } from "vitest";
import { classifySubmission, handleOutcome } from "./messageLifecycle.js";

/**
 * The owner sent a message, refreshed, and it was gone - nobody had processed
 * it and nothing recorded that it had existed.
 *
 * Delivery had two branches: a recognised network failure kept the row,
 * everything else deleted it and put the words back in the composer. A request
 * that went unanswered - a slow daemon, a timeout - fell into "everything
 * else". So the row was deleted while the daemon still held the message.
 */

const refusals = (error: unknown): boolean => error instanceof Error && error.message.startsWith("refused:");

describe("classifying what came back", () => {
  it("calls a clean return accepted", () => {
    expect(classifySubmission(undefined, refusals)).toEqual({ state: "accepted" });
  });

  it("calls a definite refusal refused, with its reason", () => {
    expect(classifySubmission(new Error("refused: no such session"), refusals)).toEqual({ state: "refused", reason: "refused: no such session" });
  });

  /** The case that lost messages: a timeout is not a verdict. */
  it("calls a timeout unanswered, not refused", () => {
    expect(classifySubmission(new Error("The server did not answer within 30s."), refusals).state).toBe("unanswered");
  });

  /**
   * An error nobody recognises is unanswered too. The costs are asymmetric:
   * calling an unanswered request a refusal deletes a message that exists,
   * while the reverse only leaves a row that can be retried or dismissed.
   */
  it("calls an unrecognised error unanswered rather than guessing", () => {
    expect(classifySubmission(new Error("something nobody wrote a pattern for"), refusals).state).toBe("unanswered");
  });
});

describe("what each outcome permits", () => {
  it("keeps the row and clears the outbox once accepted", () => {
    expect(handleOutcome({ state: "accepted" })).toEqual({ keepRow: true, restoreComposer: false, keepInOutbox: false, retryable: false });
  });

  it("takes the row away and hands the words back on a refusal", () => {
    expect(handleOutcome({ state: "refused", reason: "no" })).toEqual({ keepRow: false, restoreComposer: true, keepInOutbox: false, retryable: false });
  });

  /**
   * The whole point: an unanswered submission keeps the row, keeps the words
   * out of the composer, and stays in the outbox. Deleting the row claims the
   * message does not exist; restoring the composer invites a second copy of a
   * message the daemon may already be running.
   */
  it("keeps everything and stays retryable when nobody answered", () => {
    expect(handleOutcome({ state: "unanswered", reason: "timeout" })).toEqual({ keepRow: true, restoreComposer: false, keepInOutbox: true, retryable: true });
  });

  it("never both deletes the row and keeps it in the outbox", () => {
    for (const outcome of [{ state: "accepted" as const }, { state: "refused" as const, reason: "r" }, { state: "unanswered" as const, reason: "u" }]) {
      const handling = handleOutcome(outcome);
      expect(handling.keepInOutbox && !handling.keepRow).toBe(false);
    }
  });

  /** Restoring the composer while the message may still be running is how one message became two. */
  it("never restores the composer for a message that might still be live", () => {
    expect(handleOutcome({ state: "unanswered", reason: "u" }).restoreComposer).toBe(false);
    expect(handleOutcome({ state: "accepted" }).restoreComposer).toBe(false);
  });
});
