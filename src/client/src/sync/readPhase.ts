import { HttpError } from "../api/http";

/**
 * Where a read of one shown value stands (object model §0, B48).
 *
 * The owner, 2026-09-30: a surface keeps updating itself, and there is no final
 * "failed" - "其实只有正在尝试重连/同步，同步中两个状态". A read that got no
 * answer is not an outcome; it is a retry that has not happened yet.
 * - `syncing`: a read for this key is in flight and nothing newer is known.
 * - `live`: an answer for this key arrived; events and heads keep it current.
 * - `reconnecting`: the last read got no answer; the next try is scheduled.
 */
export type ReadPhase = "syncing" | "live" | "reconnecting";

/**
 * A definite answer that ends retrying for a key. It comes only from a server
 * that answered, never from a missing answer, and is shown as itself.
 */
export type ReadFact = { kind: "none" } | { kind: "signed-out" } | { kind: "forbidden" };

export const NO_FACT: ReadFact = { kind: "none" };

const FACT_BY_STATUS = new Map<number, ReadFact>([
  [401, { kind: "signed-out" }],
  [403, { kind: "forbidden" }],
]);

/**
 * What a failed read means. Only a refusal the server stated is a fact; a
 * dropped connection, a deadline, a 5xx or a restarting daemon is no answer,
 * and the read is tried again.
 */
export function classifyReadError(error: unknown): "no-answer" | ReadFact {
  if (!(error instanceof HttpError)) return "no-answer";
  return FACT_BY_STATUS.get(error.status) ?? "no-answer";
}

export const FIRST_RETRY_MS = 1000;

/** The wait before retry number `attempt` (0-based): 1, 2, 4, 8 s, capped at the quiet window. */
export function retryDelayMs(attempt: number, capMs: number): number {
  return Math.min(FIRST_RETRY_MS * 2 ** Math.max(0, attempt), capMs);
}
