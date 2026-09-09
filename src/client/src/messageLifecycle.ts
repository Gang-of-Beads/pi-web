import { classifySettlement, type AmbiguityReason, type OperationSettlement } from "../../shared/operationSettlement.js";
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
/**
 * A message outcome is one settlement plus the sentence a person reads.
 *
 * The three states are the repository's fixed vocabulary
 * (`src/shared/operationSettlement.ts`): accepted, refused, unverifiable. The
 * third used to be called "unanswered" here and "timed out" in the banner and
 * "failed" in the command row - three names for the state that matters most.
 */
export interface MessageOutcome {
  readonly settlement: OperationSettlement;
  readonly detail: string;
}

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
  switch (outcome.settlement.outcome) {
    case "accepted":
      return { keepRow: true, restoreComposer: false, keepInOutbox: false, retryable: false };
    case "refused":
      return { keepRow: false, restoreComposer: true, keepInOutbox: false, retryable: false };
    case "unverifiable":
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
export function classifySubmission(
  error: unknown,
  isDefiniteRefusal: (error: unknown) => boolean,
  transport: { readonly bytesHandedToTransport: boolean; readonly ambiguity?: AmbiguityReason } = { bytesHandedToTransport: true },
): MessageOutcome {
  if (error === undefined) return { settlement: classifySettlement({ answer: "accepted", bytesHandedToTransport: true }), detail: "" };
  const detail = error instanceof Error ? error.message : JSON.stringify(error);
  if (isDefiniteRefusal(error)) {
    return { settlement: classifySettlement({ answer: "refused", refusalReason: "rejected-by-server", bytesHandedToTransport: true }), detail };
  }
  return {
    settlement: classifySettlement({
      ambiguity: transport.ambiguity ?? "no-answer-within-deadline",
      bytesHandedToTransport: transport.bytesHandedToTransport,
    }),
    detail,
  };
}

/**
 * What the transport can honestly say about a failed attempt.
 *
 * A deadline that expired means the request left and no answer came back; the
 * work may well be running. A send attempted with the link already down never
 * left this process, which is the one case where resending is trivially safe.
 */
export function transportFactsFor(
  error: unknown,
  facts: { readonly isTimeout: boolean; readonly linkOffline: boolean },
): { readonly bytesHandedToTransport: boolean; readonly ambiguity: AmbiguityReason } {
  if (facts.linkOffline) return { bytesHandedToTransport: false, ambiguity: "link-offline" };
  if (facts.isTimeout) return { bytesHandedToTransport: true, ambiguity: "no-answer-within-deadline" };
  return { bytesHandedToTransport: true, ambiguity: "link-lost-in-flight" };
}
