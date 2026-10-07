import { html, type TemplateResult } from "lit";
import type { RetiredBy } from "../notice.js";
import type { ReadMiss } from "../sync/readPhase.js";

/**
 * The shared error banner. Every state in the app row is momentary (owner,
 * 2026-10-04): it has no close key, and it leaves when another message replaces
 * it, the owning action clears it, its expiry passes (`noticeExpiryMs`), or -
 * for a claim about a link - the machine's own answers retire it. A failure the
 * reader can act on keeps its Retry while it shows.
 *
 * A few transport/reconnect failures are noisy but usually self-heal after the
 * next retry or a sessiond restart. Those still deserve visibility, but not a
 * full red "something is broken forever" treatment that steals the whole top of
 * the phone UI.
 */
/**
 * The wording table only rewrites a reply-retired transport claim. A
 * reader-retired failure keeps its own words: rewriting "Update failed: …"
 * into "Reconnecting to the session daemon…" presented a permanent failure as
 * a self-healing one and deleted the operation the reader needs to retry.
 */
export function errorBanner(
  error: string,
  retiredBy: RetiredBy = "reply",
  onRetry?: () => void,
): TemplateResult | null {
  if (error === "") return null;
  const transient = retiredBy === "reply" ? normalizeTransientError(error) : undefined;
  // A failure the reader has to retire keeps a way to try again: a red line
  // with nothing but a cross is a dead end, and the owner met one on a
  // session read that answered "Session not found".
  const retry = transient === undefined && onRetry !== undefined
    ? html`<button type="button" class="error-retry" @click=${() => { onRetry(); }}>Retry</button>`
    : null;
  return html`<div class=${`error${transient === undefined ? "" : " transient"}`} role=${transient === undefined ? "alert" : "status"}>
    <span class="error-text">${transient ?? error}</span>
    ${retry}
  </div>`;
}

type MissKind = ReadMiss["kind"];
type MissOf<K extends MissKind> = Extract<ReadMiss, { kind: K }>;
type MachineName = (machineId: string) => string;

/** The row's words for each miss (object model §2.3); a machine is named, and a server error keeps its own words (owner Q9). */
const UNANSWERED_WORDS: { readonly [K in MissKind]: (miss: MissOf<K>, nameOf: MachineName) => string } = {
  "link-down": () => "Trying to sync with the server…",
  "machine-unanswering": (miss, nameOf) => `Trying to sync with ${nameOf(miss.machineId)}…`,
  "server-error": (miss, nameOf) => `${nameOf(miss.machineId)}: ${miss.reason}`,
};

export function unansweredRowText<K extends MissKind>(miss: MissOf<K>, nameOf: MachineName): string {
  const words: (miss: MissOf<K>, nameOf: MachineName) => string = UNANSWERED_WORDS[miss.kind];
  return words(miss, nameOf);
}

/**
 * The app row while a read for the machine in use goes unanswered (B48),
 * saying why. It has no cross and no expiry: it leaves when an answer comes,
 * and the page retries by itself, so there is nothing to press (owner,
 * 2026-09-30).
 */
export function unansweredRow(miss: ReadMiss, nameOf: MachineName): TemplateResult {
  return html`<div class="error transient" role="status"><span class="error-text">${unansweredRowText(miss, nameOf)}</span></div>`;
}

/**
 * The app row while a list on screen shows what this browser remembered and
 * its live answer has not landed (owner, 2026-10-07). Quieter than the
 * unanswered row: nothing is wrong yet, the page is loading.
 */
export function syncingRow(): TemplateResult {
  return html`<div class="error transient syncing" role="status"><span class="error-text">Syncing…</span></div>`;
}

/**
 * Whether a message is one of the self-healing transport failures.
 *
 * The classification seam: notice.ts asks it whether an error's text carries
 * transport evidence (retirement follows the evidence, not the exception's
 * class), and the banner asks it how to shorten a reply-retired string for
 * display. A reader-retired failure is never rewritten.
 */
export function isTransientError(error: string): boolean {
  return normalizeTransientError(error) !== undefined;
}

/**
 * How long a self-healing message stays before it withdraws itself.
 *
 * Long enough to read at a glance, short enough that a reconnect notice does
 * not outlive the reconnect it describes.
 */
export const TRANSIENT_ERROR_TIMEOUT_MS = 6000;

/** How long a notice about one operation stays: long enough to read and press Retry. */
export const READER_NOTICE_TIMEOUT_MS = 10_000;

/**
 * When a row message leaves by itself. A self-healing transport claim goes after
 * `TRANSIENT_ERROR_TIMEOUT_MS`; a notice about an operation after
 * `READER_NOTICE_TIMEOUT_MS`; a claim that asserts a machine's state (a composed
 * "X is unavailable; reconnecting…") stays until that machine answers, so it is
 * never undefined while true.
 */
export function noticeExpiryMs(retiredBy: RetiredBy, error: string): number | undefined {
  if (error === "") return undefined;
  if (retiredBy === "reader") return READER_NOTICE_TIMEOUT_MS;
  return normalizeTransientError(error) === undefined ? undefined : TRANSIENT_ERROR_TIMEOUT_MS;
}

export function normalizeTransientError(error: string): string | undefined {
  // ENOENT when the socket file is gone, ECONNREFUSED while the daemon is
  // restarting and nothing is listening on it yet. The second is the one a user
  // is guaranteed to meet, because it is what an update looks like.
  //
  // The wording between "session daemon" and "unavailable" varies by the route
  // that reports it: the workspace catalog says "workspace authority", while
  // the session proxy, the plugin backend proxy and workspace deletion say
  // nothing at all. Naming one of them, as this rule first did, left the
  // commonest banner sitting on the screen long after the daemon was back.
  // A composed message already names its machine ("X is unavailable;
  // reconnecting… <detail>"): shortening it would erase the machine, so only
  // uncomposed claims reach the rewrites below. Three producers compose the
  // prefix today - machineDownNotice and the explicit-selection path in the
  // machine controller, and the restore ladder's retry sentence in
  // PiWebApp - keep that count true when adding a fourth.
  const composed = /^trying to sync with /i.test(error);
  // A TCP-endpoint deployment has no socket path in the error text, so the
  // socket-path requirement missed the same outage there; the daemon's own
  // phrase ("session daemon") carries the identification instead.
  if (!composed && /unavailable: connect (enoent|econnrefused)/i.test(error) && (/sessiond\.sock/i.test(error) || /session daemon/i.test(error))) {
    return "Trying to sync with the server…";
  }
  // Matches the DOMException text a cancelled fetch stringifies to. The
  // earlier rule required "model response failed:", which only ever prefixes
  // a transcript system line, so it never fired on the banner it was
  // written for.
  if (!composed && /\boperation was aborted\b/i.test(error)) {
    return "Previous request was interrupted. Retry if the message did not finish.";
  }
  if (!composed && /remote machine request cancelled/i.test(error)) {
    return "Connection changed while the request was in flight. Retrying is usually enough.";
  }
  // A deadline miss says so in its own words (requestDeadline.ts). The polls
  // re-issue themselves and a session that was streaming goes on replying, so
  // this heals like a reconnect, not like a failed action.
  if (!composed && /did not answer within/i.test(error)) {
    return "Trying to sync with the server…";
  }
  // What a dropped connection looks like from `fetch`: Chrome says "Failed to
  // fetch", Safari "Load failed", Firefox "NetworkError when attempting to
  // fetch resource". A phone that slept, a tunnel that blinked, or a web
  // process being restarted all land here, and all of them heal by themselves -
  // the raw TypeError text stayed on screen long after the connection was back.
  // The match is anchored to the whole message: this family's phrases also
  // appear as the detail of a composed message ("X is unavailable; reconnecting…
  // Failed to fetch"), and rewriting that would erase the machine's name.
  if (/^(failed to fetch|load failed|networkerror when attempting to fetch resource)[.!]?$/i.test(error)) {
    return "Trying to sync with the server…";
  }
  // The gateway's own two labels, whole-message (its detail arrives inside
  // parentheses). Same claim as the local daemon's: the hop in between is
  // down, and it heals.
  if (/^remote machine (unavailable|timeout)/i.test(error)) {
    return "Trying to sync with the machine…";
  }
  // An HTTP 5xx from the web process (a proxy answering while the daemon or
  // upstream is mid-restart) heals like a dropped socket: the polls re-issue
  // and a later answer withdraws the claim. Whole-message, so "The request
  // failed (409)" - a real refusal - keeps its own words.
  if (/^the request failed \(5\d\d\)$/i.test(error)) {
    return "Connection problem. Retrying in the background…";
  }
  return undefined;
}
