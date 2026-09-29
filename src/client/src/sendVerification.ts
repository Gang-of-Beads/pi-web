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

export type VerificationStep =
  | { kind: "mark"; state: "received" | "failed"; retireOutbox: boolean }
  | { kind: "withdraw" }
  | { kind: "wait" };

const RECEIVED: VerificationStep = { kind: "mark", state: "received", retireOutbox: true };
const NOT_RECEIVED: VerificationStep = { kind: "mark", state: "failed", retireOutbox: false };

/**
 * The ledger's word, by outcome.
 *
 * - `pending`, `succeeded`: the daemon has it (waiting, or read), so the outbox lets go.
 * - `failed`: refused after acceptance; the row offers Retry under the same identity.
 * - `unknown`: a restart lost it before the agent read it; the ledger re-admits a retry.
 * - `withdrawn`: taken back by Stop, Clear or recall; it leaves like a withdrawal frame.
 */
const STEP_FOR_OUTCOME: Readonly<Record<string, VerificationStep>> = {
  pending: RECEIVED,
  succeeded: RECEIVED,
  failed: NOT_RECEIVED,
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
  failed: NOT_RECEIVED,
  unknown: NOT_RECEIVED,
  withdrawn: { kind: "withdraw" },
};

export function provenRowStep(answer: string | undefined): VerificationStep {
  return (answer === undefined ? undefined : PROVEN_ROW_STEP[answer]) ?? WAIT;
}
