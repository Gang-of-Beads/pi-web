import type { ReadMiss } from "./sync/readPhase";
import type { Unanswered } from "./sync/scopedResource";

/**
 * The unanswered state of a session's message status, and what the ledger's word does to a
 * row the machine already took. Pure: the controller asks and applies; this only decides.
 */

/**
 * How often a row keeps asking while the ledger cannot be reached. An ask that fails because the
 * link is down is not an answer, so it never ends the checks (owner, 2026-09-30: "keep trying,
 * and say it is reconnecting until it is through").
 */
export const VERIFY_RETRY_MS = 15_000;

/**
 * The ledger of one session went unanswered: since the first ask that got none, and why the latest
 * did (state-diagram D5, "The status of a sent message speaks through the row", P1 slice 6). It
 * belongs to its machine and session, and is a claim of the app's one row, never `state.error`.
 */
export interface MessageStatusUnanswered {
  readonly machineId: string;
  readonly sessionId: string;
  readonly since: number;
  readonly miss: ReadMiss;
}

/** Whether the claim is the one of this machine and session. */
export function isClaimOf(claim: MessageStatusUnanswered | undefined, scope: { readonly machineId: string; readonly sessionId: string }): claim is MessageStatusUnanswered {
  return claim?.machineId === scope.machineId && claim.sessionId === scope.sessionId;
}

/**
 * The claim after another unanswered moment of a session. The same session's claim keeps
 * counting from its first moment, so a retry does not restart the row's grace; any other claim is
 * replaced, and a new episode starts its own.
 */
export function claimAfterMiss(claim: MessageStatusUnanswered | undefined, scope: { readonly machineId: string; readonly sessionId: string }, miss: ReadMiss, now: number): MessageStatusUnanswered {
  return { machineId: scope.machineId, sessionId: scope.sessionId, since: isClaimOf(claim, scope) ? claim.since : now, miss };
}

/** The claim for the row, only while its machine and session are the ones on screen. */
export function messageStatusUnanswered(claim: MessageStatusUnanswered | undefined, onScreen: { machineId: string; sessionId: string | undefined }): Unanswered | undefined {
  if (claim?.machineId !== onScreen.machineId || claim.sessionId !== onScreen.sessionId) return undefined;
  return { since: claim.since, miss: claim.miss };
}

/**
 * What the ledger's word does to a row the machine already took (received or queued): only a
 * terminal fact the row missed acts - its frame went to a socket the reader had left.
 *
 * - `withdrawn`, `consumed`: taken back, or taken by a command without an entry; the row goes.
 * - `failed`: the runtime refused it for good; it is cancelled, words back in the composer.
 * - `unknown`: a restart lost it before the agent read it; it goes back into the outbox.
 */
export type VerificationStep = "withdraw" | "cancel" | "resend" | "wait";

const PROVEN_ROW_STEP: Readonly<Record<string, VerificationStep>> = {
  withdrawn: "withdraw",
  consumed: "withdraw",
  failed: "cancel",
  unknown: "resend",
};

export function provenRowStep(answer: string | undefined): VerificationStep {
  return (answer === undefined ? undefined : PROVEN_ROW_STEP[answer]) ?? "wait";
}
