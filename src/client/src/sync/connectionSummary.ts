import { BANNER_MIN_VISIBLE_MS, TRANSIENT_GRACE_MS } from "../components/bannerHold";
import type { ReadMiss } from "./readPhase";
import type { Unanswered } from "./scopedResource";

/**
 * What the app's one row says (object model §2.3).
 *
 * Owner, 2026-09-30: "action failed is not reconnecting - it is a definite failure, and a message not yet synced means something else, right? Only one of them can show at a time"
 * - a definite failure and "not synced" mean different things, and the row shows
 * one of them at a time. A definite notice (an action failed) holds the row
 * until the reader dismisses it or its owner retires it; reconnecting comes
 * back afterwards if it is still true.
 *
 * An unanswered read is counted from the first try that went without an
 * answer and lasts until one arrives, so a retry that is itself still waiting
 * never blinks the row; it says why the latest try got none (a link down, a
 * machine not answering, a server error in its own words). It waits out the
 * same grace as every transport claim - a single miss that the next retry
 * recovers shows nothing - and once shown it stays for the minimum visible
 * time, with the last reason shown, so it never flashes.
 *
 * A row on screen keeps showing only for a claim that was already outstanding
 * when it appeared. A request sent after that waits out its own grace: once
 * the ack watch counted every in-flight request, "something is unanswered"
 * was true for every healthy read in flight, and waiving the grace for it let
 * the row stay up while the server answered everything (review 2026-10-07).
 */
export type RowClaim = { readonly kind: "none" } | { readonly kind: "notice" } | { readonly kind: "unanswered"; readonly miss: ReadMiss };

export interface RowDecision {
  readonly claim: RowClaim;
  /** When the decision can change on its own (the grace ends, the hold ends). */
  readonly recheckInMs?: number;
}

/** The unanswered row on screen: since when, and the reason it shows. */
export interface ShownUnanswered {
  readonly at: number;
  readonly miss: ReadMiss;
}

export interface RowInput {
  /** A definite notice is on screen: the reader must retire it. */
  readonly notice: boolean;
  /** Since when the machine in use has gone without an answer, and why, if it has. */
  readonly unanswered: Unanswered | undefined;
  /** The unanswered row, if it is showing. */
  readonly shown: ShownUnanswered | undefined;
  readonly now: number;
}

const NONE: RowClaim = { kind: "none" };

export function rowDecision(input: RowInput): RowDecision {
  if (input.notice) return { claim: { kind: "notice" } };
  const { unanswered, shown, now } = input;
  if (unanswered !== undefined && earnsRow(unanswered, shown, now)) return { claim: { kind: "unanswered", miss: unanswered.miss } };
  const graceLeft = unanswered === undefined ? undefined : TRANSIENT_GRACE_MS - (now - unanswered.since);
  const holdLeft = shown === undefined ? 0 : BANNER_MIN_VISIBLE_MS - (now - shown.at);
  if (shown !== undefined && holdLeft > 0) return { claim: { kind: "unanswered", miss: shown.miss }, recheckInMs: Math.min(holdLeft, graceLeft ?? holdLeft) };
  return graceLeft === undefined ? { claim: NONE } : { claim: NONE, recheckInMs: graceLeft };
}

function earnsRow(unanswered: Unanswered, shown: ShownUnanswered | undefined, now: number): boolean {
  return now - unanswered.since >= TRANSIENT_GRACE_MS || (shown !== undefined && unanswered.since <= shown.at);
}
