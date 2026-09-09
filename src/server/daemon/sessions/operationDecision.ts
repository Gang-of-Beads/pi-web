/**
 * What the daemon does with an operation it may have seen before.
 *
 * The browser retries with the same identity whenever an answer was lost -
 * exactly the `unverifiable` settlement the client now shows. The daemon has to
 * answer that retry rather than run the work a second time, and the current
 * ledger cannot: it is a set of accepted ids, in memory, forgotten on restart,
 * with no record of what was asked or how it ended.
 *
 * This module is the decision, kept pure and separate from where the rows live:
 *
 *   admit    nothing on file, or a row this attempt is entitled to take over
 *   replay   a recorded outcome answers this attempt; do not run it again
 *   refuse   the attempt cannot be served, with the reason named
 *
 * The rules that matter, each of them a defect this shape prevents:
 *
 * - A repeat with a *different* payload is a conflict, not a replay. Answering
 *   it with the first outcome would silently drop what the caller asked for.
 * - Capacity refuses rather than evicting. Dropping a row to make space turns a
 *   later replay back into a second execution, which is the one outcome the
 *   ledger exists to prevent.
 * - A restart cannot claim an operation succeeded or failed; every row still
 *   pending becomes `unknown`, which is honest and lets the client close it by
 *   asking rather than by resending blind.
 */

export type OperationOutcome = "pending" | "succeeded" | "failed" | "unknown";

export type OperationRefusalCode = "invalid" | "conflict" | "expired" | "capacity";

export type OperationDecision =
  | Readonly<{ kind: "admit" }>
  /** The same operation is still running here; the caller waits rather than starting a second one. */
  | Readonly<{ kind: "in-flight"; since: number }>
  | Readonly<{ kind: "replay"; outcome: Exclude<OperationOutcome, "pending">; recordedAt: number }>
  | Readonly<{ kind: "refuse"; code: OperationRefusalCode }>;

export interface OperationRow {
  readonly operationId: string;
  readonly fingerprint: string;
  readonly outcome: OperationOutcome;
  readonly recordedAt: number;
  readonly updatedAt: number;
}

export interface OperationRequest {
  readonly operationId: string;
  readonly fingerprint: string;
  readonly now: number;
}

export interface LedgerLimits {
  /** Rows held per session. Reaching it refuses rather than evicting. */
  readonly capacity: number;
  /** How long a row answers replays. Past it, a repeat is refused as expired. */
  readonly retentionMs: number;
  /** A pending row older than this is treated as unknown by readers. */
  readonly pendingStaleMs: number;
}

export const DEFAULT_LEDGER_LIMITS: LedgerLimits = {
  capacity: 512,
  retentionMs: 24 * 60 * 60 * 1000,
  pendingStaleMs: 10 * 60 * 1000,
};

/**
 * An id must carry the time it was minted, so a row that has aged out cannot be
 * confused with one minted after the retention window - the case where a stale
 * replay would otherwise be admitted as new work.
 */
export function isWellFormedOperationId(operationId: string): boolean {
  return /^[A-Za-z0-9._:-]{8,128}$/u.test(operationId);
}

export function decideOperation(
  existing: OperationRow | undefined,
  request: OperationRequest,
  rowCount: number,
  limits: LedgerLimits = DEFAULT_LEDGER_LIMITS,
): OperationDecision {
  if (!isWellFormedOperationId(request.operationId) || request.fingerprint === "") {
    return { kind: "refuse", code: "invalid" };
  }
  if (existing === undefined) {
    if (rowCount >= limits.capacity) return { kind: "refuse", code: "capacity" };
    return { kind: "admit" };
  }
  if (existing.fingerprint !== request.fingerprint) return { kind: "refuse", code: "conflict" };
  if (request.now - existing.recordedAt > limits.retentionMs) return { kind: "refuse", code: "expired" };
  if (existing.outcome === "pending") {
    // A pending row that has gone quiet for longer than a turn can plausibly
    // take is not evidence of anything; say unknown rather than leaving the
    // caller waiting on a row nobody is going to settle.
    if (request.now - existing.updatedAt > limits.pendingStaleMs) {
      return { kind: "replay", outcome: "unknown", recordedAt: existing.recordedAt };
    }
    return { kind: "in-flight", since: existing.updatedAt };
  }
  return { kind: "replay", outcome: existing.outcome, recordedAt: existing.recordedAt };
}

/**
 * What a restart may assert about the rows it reloads.
 *
 * Nothing that was in flight can be claimed to have succeeded or failed: the
 * process that knew died. `unknown` is the only honest answer, and it is the
 * one the client can act on.
 */
export function afterRestart(row: OperationRow): OperationRow {
  if (row.outcome !== "pending") return row;
  return { ...row, outcome: "unknown" };
}
