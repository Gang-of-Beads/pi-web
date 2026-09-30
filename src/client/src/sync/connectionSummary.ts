import { BANNER_MIN_VISIBLE_MS, TRANSIENT_GRACE_MS } from "../components/bannerHold";

/**
 * What the app's one row says (object model §2.3).
 *
 * Owner, 2026-09-30: "action failed 并不是重连啊，这个是明确的失败，和消息没被同步是两个语义吧？同一时间只有一个能显示"
 * - a definite failure and "not synced" mean different things, and the row shows
 * one of them at a time. A definite notice (an action failed) holds the row
 * until the reader dismisses it or its owner retires it; reconnecting comes
 * back afterwards if it is still true.
 *
 * Reconnecting is counted from the first read that went without an answer and
 * lasts until one arrives, so a retry that is itself still waiting never
 * blinks the row. It waits out the same grace as every transport claim - a
 * single lost answer that the next retry recovers shows nothing - and once
 * shown it stays for the minimum visible time, so it never flashes.
 */
export type RowClaim = "none" | "notice" | "reconnecting";

export interface RowDecision {
  readonly claim: RowClaim;
  /** When the decision can change on its own (the grace ends, the hold ends). */
  readonly recheckInMs?: number;
}

export interface RowInput {
  /** A definite notice is on screen: the reader must retire it. */
  readonly notice: boolean;
  /** Since when the machine in use has gone without an answer, if it has. */
  readonly unansweredSince: number | undefined;
  /** When the reconnecting row appeared, if it is showing. */
  readonly reconnectingShownAt: number | undefined;
  readonly now: number;
}

export function rowDecision(input: RowInput): RowDecision {
  if (input.notice) return { claim: "notice" };
  if (input.unansweredSince !== undefined) return unansweredRow(input.now - input.unansweredSince, input.reconnectingShownAt !== undefined);
  if (input.reconnectingShownAt === undefined) return { claim: "none" };
  const shownFor = input.now - input.reconnectingShownAt;
  if (shownFor >= BANNER_MIN_VISIBLE_MS) return { claim: "none" };
  return { claim: "reconnecting", recheckInMs: BANNER_MIN_VISIBLE_MS - shownFor };
}

function unansweredRow(waited: number, alreadyShown: boolean): RowDecision {
  if (alreadyShown || waited >= TRANSIENT_GRACE_MS) return { claim: "reconnecting" };
  return { claim: "none", recheckInMs: TRANSIENT_GRACE_MS - waited };
}
