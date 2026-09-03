/**
 * What happened to a message the user sent, and what may be done about it.
 *
 * Delivery used to be decided by two branches: a network failure kept the row
 * and anything else deleted it. A request that simply went unanswered fell into
 * "anything else", so a slow daemon deleted the sender's row and put the words
 * back in the composer - while the daemon went on to queue the message it had
 * already received. One message, two places, and the reader with no way to know
 * which was real.
 *
 * The states below are the whole set. Every outcome of a submission maps to
 * exactly one of them, and each names who is entitled to assert it.
 */
export type MessageOutcome =
  /** The daemon answered and owns the message. Only the daemon can say this. */
  | { state: "accepted" }
  /** The daemon refused, with a reason. Only a definite refusal reaches here. */
  | { state: "refused"; reason: string }
  /**
   * Nobody answered within the budget, or the link failed. This is not a
   * refusal: the daemon may hold the message already. The row stays, the words
   * stay out of the composer, and the entry stays in the outbox for retry.
   */
  | { state: "unanswered"; reason: string };

/** What the caller may do with the sender's row and their composer. */
export interface OutcomeHandling {
  /** Whether the optimistic row survives. */
  keepRow: boolean;
  /** Whether the typed words go back into the composer. */
  restoreComposer: boolean;
  /** Whether the entry stays in the durable outbox, to be retried. */
  keepInOutbox: boolean;
  /** Whether a retry with the same identity is safe and expected. */
  retryable: boolean;
}

/**
 * How to treat each outcome.
 *
 * The asymmetry is deliberate. A refusal is a verdict, so the message is gone
 * and the words are handed back for editing. An unanswered request is not a
 * verdict about anything: deleting the row would claim the message does not
 * exist, and restoring the composer would invite a second copy of a message the
 * daemon may already be running.
 */
export function handleOutcome(outcome: MessageOutcome): OutcomeHandling {
  switch (outcome.state) {
    case "accepted":
      return { keepRow: true, restoreComposer: false, keepInOutbox: false, retryable: false };
    case "refused":
      return { keepRow: false, restoreComposer: true, keepInOutbox: false, retryable: false };
    case "unanswered":
      return { keepRow: true, restoreComposer: false, keepInOutbox: true, retryable: true };
  }
}

/**
 * Classify what came back from a submission.
 *
 * Anything that is not a definite answer from the daemon is unanswered. That
 * includes a timeout, a dropped link, and an error nobody recognises - because
 * the cost of guessing wrong is asymmetric: calling an unanswered request a
 * refusal deletes a message that exists, while calling a refusal unanswered
 * only leaves a row the reader can retry or dismiss.
 */
export function classifySubmission(error: unknown, isDefiniteRefusal: (error: unknown) => boolean): MessageOutcome {
  if (error === undefined) return { state: "accepted" };
  const reason = error instanceof Error ? error.message : JSON.stringify(error);
  return isDefiniteRefusal(error) ? { state: "refused", reason } : { state: "unanswered", reason };
}
