import type { DeliveryFailureCause } from "./deliveryWords";
import type { ReadMiss } from "./sync/readPhase";
import type { Unanswered } from "./sync/scopedResource";

/**
 * What a send nobody answered for becomes when the daemon's ledger is asked about it.
 *
 * An unverifiable row used to leave only on a reconnect: with a healthy socket nothing asked
 * again, and a message the daemon never received had no fact left to arrive, so "No answer
 * yet" could wait forever. The ledger is now asked on a clock (5 s, 15 s, 45 s after the send
 * gave up) and when the tab comes back, and every answer it can give has a step here.
 *
 * Pure: the controller asks and applies; this only decides.
 */

/** When to ask the ledger, counted from the moment the send gave up. */
export const VERIFY_AFTER_MS: readonly number[] = [5_000, 15_000, 45_000];

/**
 * How often a row keeps asking while the ledger cannot be reached. An ask that fails because the
 * link is down is not an answer, so it never ends the checks (owner, 2026-09-30: "keep trying,
 * and say it is reconnecting until it is through"); an ask after the last scheduled one is a last
 * ask, so a daemon with no row for the message calls it not received once it can say so.
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

/** The claim for the row, only while its machine and session are the ones on screen. */
export function messageStatusUnanswered(claim: MessageStatusUnanswered | undefined, onScreen: { machineId: string; sessionId: string | undefined }): Unanswered | undefined {
  if (claim?.machineId !== onScreen.machineId || claim.sessionId !== onScreen.sessionId) return undefined;
  return { since: claim.since, miss: claim.miss };
}

export type VerificationStep =
  | { kind: "mark"; state: "received"; retireOutbox: boolean }
  | { kind: "fail"; cause: DeliveryFailureCause }
  | { kind: "withdraw" }
  | { kind: "wait" };

/** The daemon holds it and the agent has not read it: the record stays, in case the runtime refuses it. */
const RECEIVED: VerificationStep = { kind: "mark", state: "received", retireOutbox: false };
/** The agent read it: nothing can refuse it any more, so the record goes. */
const READ: VerificationStep = { kind: "mark", state: "received", retireOutbox: true };
const NOT_RECEIVED: VerificationStep = { kind: "fail", cause: "not-received" };
/** The runtime refused it after the inbox took it: it never became part of the conversation. */
const REFUSED: VerificationStep = { kind: "fail", cause: "not-sent" };

/**
 * The ledger's word, by outcome.
 *
 * - `pending`: the daemon has it and the agent has not read it; the record stays in case the runtime refuses it.
 * - `succeeded`: the agent read it, so the outbox lets go.
 * - `failed`: refused after acceptance; the row offers Retry under the same identity.
 * - `unknown`: a restart lost it before the agent read it; the ledger re-admits a retry.
 * - `withdrawn`: taken back by Stop, Clear or recall; it leaves like a withdrawal frame.
 */
const STEP_FOR_OUTCOME: Readonly<Record<string, VerificationStep>> = {
  pending: RECEIVED,
  succeeded: READ,
  failed: REFUSED,
  unknown: NOT_RECEIVED,
  withdrawn: { kind: "withdraw" },
};

/**
 * The step for one identity. No row (or an answer this build does not know) is not a verdict
 * while the request may still reach the daemon; on the last ask it is: the daemon never got
 * the message, and a retry under the same identity is safe.
 */
export function verificationStep(answer: string | undefined, lastAsk: boolean): VerificationStep {
  const known = answer === undefined ? undefined : STEP_FOR_OUTCOME[answer];
  if (known !== undefined) return known;
  return lastAsk ? NOT_RECEIVED : { kind: "wait" };
}

const WAIT: VerificationStep = { kind: "wait" };

/**
 * The ledger's word on a row a server fact already proved - received, or held by the queue.
 * Only a terminal fact the row missed acts: a refusal or a loss it never heard about (its frame
 * went to a socket the reader had left), or a withdrawal. Pending, read, or no row say nothing
 * the row does not already know; the transcript settles a read one.
 */
const PROVEN_ROW_STEP: Readonly<Record<string, VerificationStep>> = {
  failed: REFUSED,
  unknown: NOT_RECEIVED,
  withdrawn: { kind: "withdraw" },
};

export function provenRowStep(answer: string | undefined): VerificationStep {
  return (answer === undefined ? undefined : PROVEN_ROW_STEP[answer]) ?? WAIT;
}
