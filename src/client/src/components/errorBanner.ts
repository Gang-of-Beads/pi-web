import { html, type TemplateResult } from "lit";
import type { RetiredBy } from "../notice.js";
import type { TransportClaim } from "../api/transportClaim.js";
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
 * The row's words for a failure that claims the link is down (B16): short, and saying it heals,
 * because it does. Any other failure keeps its own words, so "Update failed: …" is never presented
 * as a self-healing hiccup and the operation the reader needs to retry stays named.
 */
const TRANSPORT_WORDS: Readonly<Record<TransportClaim, string>> = {
  "daemon-not-listening": "Trying to sync with the server…",
  "machine-unreachable": "Trying to sync with the machine…",
  network: "Trying to sync with the server…",
  deadline: "Trying to sync with the server…",
  aborted: "Previous request was interrupted. Retry if the message did not finish.",
  "server-error": "Connection problem. Retrying in the background…",
};

export function errorBanner(
  error: string,
  claim: TransportClaim | undefined,
  onRetry?: () => void,
): TemplateResult | null {
  if (error === "") return null;
  const transient = claim === undefined ? undefined : TRANSPORT_WORDS[claim];
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
 * How long a self-healing message stays before it withdraws itself.
 *
 * Long enough to read at a glance, short enough that a reconnect notice does
 * not outlive the reconnect it describes.
 */
export const TRANSIENT_ERROR_TIMEOUT_MS = 6000;

/** How long a notice about one operation stays: long enough to read and press Retry. */
export const READER_NOTICE_TIMEOUT_MS = 10_000;

/**
 * When a row message leaves by itself. A notice carrying a transport claim goes
 * after `TRANSIENT_ERROR_TIMEOUT_MS`; a notice about an operation after
 * `READER_NOTICE_TIMEOUT_MS`; a reply-retired notice with no claim (the page's
 * own "Trying to sync with X…" about a machine) stays until that machine
 * answers, so it is never undefined while true.
 */
export function noticeExpiryMs(retiredBy: RetiredBy, claim: TransportClaim | undefined, error: string): number | undefined {
  if (error === "") return undefined;
  if (retiredBy === "reader") return READER_NOTICE_TIMEOUT_MS;
  return claim === undefined ? undefined : TRANSIENT_ERROR_TIMEOUT_MS;
}
