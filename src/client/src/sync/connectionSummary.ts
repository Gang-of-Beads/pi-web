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
export type RowClaim = { readonly kind: "none" } | { readonly kind: "notice" } | { readonly kind: "unanswered"; readonly miss: ReadMiss } | { readonly kind: "syncing"; readonly machineId: string };

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
  /**
   * The machine the page knows it is behind, and since when: it is fetching what it missed (owner,
   * 2026-10-14: Syncing is a known gap being filled, not a list drawn from memory). The quietest
   * claim, and only once the fetch has taken `SYNCING_AFTER_MS` ("补数超过1秒").
   */
  readonly behind: { readonly machineId: string; readonly since: number } | undefined;
  /** When the page last came into view; undefined while it is hidden (`graceLeftMs`). */
  readonly lookingSince: number | undefined;
  readonly now: number;
}

const NONE: RowClaim = { kind: "none" };

/** How long a fetch of what the page missed runs before the row says Syncing; most land in well under it. */
export const SYNCING_AFTER_MS = 1000;

/**
 * How much of the grace a claim that began at `since` has left; zero or less means it has earned
 * the row. Only time the page is in view counts (owner, 2026-10-12: "Trying to sync" showed on
 * every return to the browser). A phone freezes a hidden page and closes its links, so a request
 * in flight at the switch, or a socket that dropped while away, carries a start from before the
 * return; counting from it found minutes waited and showed the row before the return's own reads
 * could answer. The grace therefore starts no earlier than the page's last return to view.
 */
export function graceLeftMs(since: number, lookingSince: number, now: number): number {
  return TRANSIENT_GRACE_MS - (now - Math.max(since, lookingSince));
}

/**
 * A hidden page shows no row: it earns no unanswered row, keeps no held one, and claims no
 * Syncing; a notice still wins. No recheck is scheduled while hidden; the caller decides again on
 * visibilitychange, and a return never inherits a row because the grace starts again in view.
 */
export function rowDecision(input: RowInput): RowDecision {
  if (input.notice) return { claim: { kind: "notice" } };
  const { unanswered, shown, now, lookingSince } = input;
  if (lookingSince === undefined) return { claim: NONE };
  const graceLeft = unanswered === undefined ? undefined : graceLeftMs(unanswered.since, lookingSince, now);
  if (unanswered !== undefined && graceLeft !== undefined && earnsRow(unanswered, graceLeft, shown)) return { claim: { kind: "unanswered", miss: unanswered.miss } };
  const holdLeft = shown === undefined ? 0 : BANNER_MIN_VISIBLE_MS - (now - shown.at);
  if (shown !== undefined && holdLeft > 0) return { claim: { kind: "unanswered", miss: shown.miss }, recheckInMs: Math.min(holdLeft, graceLeft ?? holdLeft) };
  const behindLeft = input.behind === undefined ? undefined : SYNCING_AFTER_MS - (now - Math.max(input.behind.since, lookingSince));
  const claim: RowClaim = input.behind !== undefined && behindLeft !== undefined && behindLeft <= 0 ? { kind: "syncing", machineId: input.behind.machineId } : NONE;
  const recheck = [graceLeft, behindLeft].filter((left): left is number => left !== undefined && left > 0);
  return recheck.length === 0 ? { claim } : { claim, recheckInMs: Math.min(...recheck) };
}

/** When the page last heard from what a miss is about: its own server, or the machine on screen. */
export interface HeardClocks {
  readonly link: number;
  readonly machine: (machineId: string) => number;
}

/**
 * A miss the page has since heard past is no claim (owner, 2026-10-12: "已经开始收到包了就直接不显示").
 * A read still waiting on its own backoff kept "Trying to sync" up while the machine's socket was
 * already delivering; anything heard from what the miss is about after it began answers it. A
 * server's error is an answer in its own words and is not retired by other traffic.
 */
export function stillUnheard(unanswered: Unanswered | undefined, heard: HeardClocks): Unanswered | undefined {
  if (unanswered === undefined) return undefined;
  return heardSince(unanswered.miss, heard) > unanswered.since ? undefined : unanswered;
}

/** When the page last heard from what `miss` is about; a server error is never answered by other traffic. */
function heardSince(miss: ReadMiss, heard: HeardClocks): number {
  switch (miss.kind) {
    case "link-down": return heard.link;
    case "machine-unanswering": return heard.machine(miss.machineId);
    case "server-error": return Number.NEGATIVE_INFINITY;
  }
}

function earnsRow(unanswered: Unanswered, graceLeft: number, shown: ShownUnanswered | undefined): boolean {
  return graceLeft <= 0 || (shown !== undefined && unanswered.since <= shown.at);
}
