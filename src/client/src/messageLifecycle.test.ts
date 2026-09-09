import { describe, expect, it } from "vitest";
import { type MessageOutcome, classifySubmission, handleOutcome } from "./messageLifecycle.js";

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

/** The three settlements, built once so the tests read as states rather than literals. */
function accepted(): MessageOutcome {
  return { settlement: { outcome: "accepted" }, detail: "" };
}

function refused(): MessageOutcome {
  return { settlement: { outcome: "refused", reason: "rejected-by-server" }, detail: "no" };
}

function unverifiable(): MessageOutcome {
  return { settlement: { outcome: "unverifiable", reason: "no-answer-within-deadline", bytesHandedToTransport: true }, detail: "timeout" };
}

describe("classifying what came back", () => {
  it("calls a clean return accepted", () => {
    expect(classifySubmission(undefined, refusals)).toEqual(accepted());
  });

  it("calls a definite refusal refused, with its reason", () => {
    expect(classifySubmission(new Error("refused: no such session"), refusals)).toEqual({
      settlement: { outcome: "refused", reason: "rejected-by-server" },
      detail: "refused: no such session",
    });
  });

  /** The case that lost messages: a timeout is not a verdict. */
  it("calls a timeout unverifiable, not refused", () => {
    expect(classifySubmission(new Error("The server did not answer within 30s."), refusals).settlement.outcome).toBe("unverifiable");
  });

  /**
   * An error nobody recognises is unanswered too. The costs are asymmetric:
   * calling an unanswered request a refusal deletes a message that exists,
   * while the reverse only leaves a row that can be retried or dismissed.
   */
  it("calls an unrecognised error unverifiable rather than guessing", () => {
    expect(classifySubmission(new Error("something nobody wrote a pattern for"), refusals).settlement.outcome).toBe("unverifiable");
  });
});

describe("what each outcome permits", () => {
  it("keeps the row and clears the outbox once accepted", () => {
    expect(handleOutcome(accepted())).toEqual({ keepRow: true, restoreComposer: false, keepInOutbox: false, retryable: false });
  });

  it("takes the row away and hands the words back on a refusal", () => {
    expect(handleOutcome(refused())).toEqual({ keepRow: false, restoreComposer: true, keepInOutbox: false, retryable: false });
  });

  /**
   * The whole point: an unanswered submission keeps the row, keeps the words
   * out of the composer, and stays in the outbox. Deleting the row claims the
   * message does not exist; restoring the composer invites a second copy of a
   * message the daemon may already be running.
   */
  it("keeps everything and stays retryable when nobody answered", () => {
    expect(handleOutcome(unverifiable())).toEqual({ keepRow: true, restoreComposer: false, keepInOutbox: true, retryable: true });
  });

  it("never both deletes the row and keeps it in the outbox", () => {
    for (const outcome of [accepted(), refused(), unverifiable()]) {
      const handling = handleOutcome(outcome);
      expect(handling.keepInOutbox && !handling.keepRow).toBe(false);
    }
  });

  /** Restoring the composer while the message may still be running is how one message became two. */
  it("never restores the composer for a message that might still be live", () => {
    expect(handleOutcome(unverifiable()).restoreComposer).toBe(false);
    expect(handleOutcome(accepted()).restoreComposer).toBe(false);
  });
});
