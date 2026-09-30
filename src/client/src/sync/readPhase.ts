import { HttpError } from "../api/http";
import { LOCAL_MACHINE_ID } from "../machineKeys";
import { SESSION_NOT_FOUND_CODE } from "../../../shared/apiTypes";

/**
 * Where a read of one shown value stands (object model §0, B48).
 *
 * The owner, 2026-09-30: a surface keeps updating itself, and there is no final
 * "failed" - "really there are only two states: trying to reconnect/sync, and syncing". A read that got no
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
export type ReadFact = { kind: "none" } | { kind: "signed-out" } | { kind: "forbidden" } | { kind: "gone" };

export const NO_FACT: ReadFact = { kind: "none" };

/**
 * Why a read went without a usable answer (object model §2.3). Every miss is
 * retried; the app row says which one it is (owner Q9: a server error shows
 * its reason, never "reconnecting").
 * - `link-down`: nothing answered - a dropped connection, a reader deadline,
 *   or a proxy in front of PI WEB answering for it;
 * - `machine-unanswering`: the web process in use answered for a remote
 *   machine that did not;
 * - `server-error`: a server answered with an error, in its own words.
 */
export type ReadMiss =
  | { readonly kind: "link-down" }
  | { readonly kind: "machine-unanswering"; readonly machineId: string }
  | { readonly kind: "server-error"; readonly machineId: string; readonly reason: string };

/** What a failed read means: a fact that ends retrying, or a miss that is retried. */
export type ReadOutcome = { readonly kind: "fact"; readonly fact: ReadFact } | { readonly kind: "miss"; readonly miss: ReadMiss };

/** Facts a server names by code, checked before any status: the daemon's missing session (P2 slice a). */
const FACT_BY_CODE = new Map<string, ReadFact>([
  [SESSION_NOT_FOUND_CODE, { kind: "gone" }],
]);

const FACT_BY_STATUS = new Map<number, ReadFact>([
  [401, { kind: "signed-out" }],
  [403, { kind: "forbidden" }],
]);

/** The statuses a hop answers with when what is behind it did not answer. */
const HOP_STATUSES = new Set([502, 503, 504]);

const LINK_DOWN: ReadOutcome = { kind: "miss", miss: { kind: "link-down" } };

/**
 * What a failed read means, decided once. Only a refusal the server stated is
 * a fact. No status (0) is a transport failure. A hop status is a remote
 * machine not answering only when PI WEB's gateway said so for a machine it
 * named; any other hop - a proxy in front of PI WEB, the local daemon - means
 * nothing answered. Any other status is a server error, in its own words.
 */
export function classifyReadError(error: unknown): ReadOutcome {
  if (!(error instanceof HttpError) || error.status === 0) return LINK_DOWN;
  const fact = (error.code === undefined ? undefined : FACT_BY_CODE.get(error.code)) ?? FACT_BY_STATUS.get(error.status);
  if (fact !== undefined) return { kind: "fact", fact };
  const machineId = error.machineId ?? LOCAL_MACHINE_ID;
  if (!HOP_STATUSES.has(error.status)) return { kind: "miss", miss: { kind: "server-error", machineId, reason: error.message === "" ? `HTTP ${String(error.status)}` : error.message } };
  const remoteUnanswering = error.answeredBy === "gateway" && machineId !== LOCAL_MACHINE_ID;
  return remoteUnanswering ? { kind: "miss", miss: { kind: "machine-unanswering", machineId } } : LINK_DOWN;
}

export const FIRST_RETRY_MS = 1000;

/** The longest any read waits before it is tried again: the quiet window *T* (object model §0). */
export const QUIET_WINDOW_MS = 15_000;

/** The wait before retry number `attempt` (0-based): 1, 2, 4, 8 s, capped at the quiet window. */
export function retryDelayMs(attempt: number, capMs: number): number {
  return Math.min(FIRST_RETRY_MS * 2 ** Math.max(0, attempt), capMs);
}
