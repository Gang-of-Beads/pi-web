/**
 * How an operation settled, in the one vocabulary this repository uses.
 *
 * The words are fixed: `accepted`, `refused`, `unverifiable`. Loss of contact
 * is never evidence of refusal, and `unverifiable` is never collapsed into
 * either neighbour — flattening it is what let a page banner say "the server
 * did not answer" while the transcript below it was still receiving the output
 * of the very command that banner was about.
 *
 * `unverifiable` carries a fact rather than an absence: whether the bytes were
 * handed to the transport. That is the question a reconnect has to answer
 * before it may resend, and it cannot be recovered later by asking the network
 * again.
 *
 * Every function here is pure. The classifier names the states; callers are
 * executors and do not re-derive them.
 */

/** Why a request was definitely refused. There is no catch-all member. */
export type RefusalReason =
  | "rejected-by-server"
  | "invalid-request"
  | "not-permitted"
  | "session-gone";

/** Why an answer could not be obtained. There is no catch-all member. */
export type AmbiguityReason =
  | "no-answer-within-deadline"
  | "link-lost-in-flight"
  | "link-offline"
  | "answer-unreadable";

export type OperationSettlement =
  | Readonly<{ outcome: "accepted" }>
  | Readonly<{ outcome: "refused"; reason: RefusalReason }>
  | Readonly<{ outcome: "unverifiable"; reason: AmbiguityReason; bytesHandedToTransport: boolean }>;

/** What the caller observed. `answered` is the only thing that can accept. */
export interface SettlementObservation {
  /** The server's own verdict, when one arrived. */
  readonly answer?: "accepted" | "refused";
  /** Present only with a refusal; a refusal without a reason is not a refusal. */
  readonly refusalReason?: RefusalReason;
  /** Why no answer arrived, when none did. */
  readonly ambiguity?: AmbiguityReason;
  /** Whether the request left this process. False before the socket wrote it. */
  readonly bytesHandedToTransport: boolean;
}

/**
 * Classify one observation into one settlement.
 *
 * A refusal must arrive with its reason, because "the server said no" and "we
 * never heard" are the two states this whole model exists to keep apart. An
 * observation that claims a refusal without a reason is therefore ambiguous,
 * not a refusal.
 */
export function classifySettlement(observation: SettlementObservation): OperationSettlement {
  if (observation.answer === "accepted") return { outcome: "accepted" };
  if (observation.answer === "refused" && observation.refusalReason !== undefined) {
    return { outcome: "refused", reason: observation.refusalReason };
  }
  return {
    outcome: "unverifiable",
    reason: observation.ambiguity ?? "answer-unreadable",
    bytesHandedToTransport: observation.bytesHandedToTransport,
  };
}

/**
 * Whether resending under the same identity is safe without server-side
 * deduplication. Bytes that never left cannot have been received.
 */
export function resendIsTriviallySafe(settlement: OperationSettlement): boolean {
  return settlement.outcome === "unverifiable" && !settlement.bytesHandedToTransport;
}

/** Whether the operation is finished as far as the user is concerned. */
export function isSettled(settlement: OperationSettlement): boolean {
  return settlement.outcome !== "unverifiable";
}

/** One sentence per state, so two surfaces cannot describe the same state differently. */
export function settlementSentence(settlement: OperationSettlement): string {
  if (settlement.outcome === "accepted") return "Accepted by the server.";
  if (settlement.outcome === "refused") return REFUSAL_SENTENCES[settlement.reason];
  return AMBIGUITY_SENTENCES[settlement.reason];
}

const REFUSAL_SENTENCES: Record<RefusalReason, string> = {
  "rejected-by-server": "The server refused this.",
  "invalid-request": "The server could not read this request.",
  "not-permitted": "Not permitted.",
  "session-gone": "That session is gone.",
};

const AMBIGUITY_SENTENCES: Record<AmbiguityReason, string> = {
  "no-answer-within-deadline": "Sent, no answer yet — it may still be running.",
  "link-lost-in-flight": "The link dropped before an answer; it may have been received.",
  "link-offline": "Not sent: the link was down.",
  "answer-unreadable": "The answer could not be read.",
};
