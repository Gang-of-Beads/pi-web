import { html, type TemplateResult } from "lit";
import type { RetiredBy } from "../notice.js";
import type { TransportClaim } from "../api/transportClaim.js";
import type { ReadMiss } from "../sync/readPhase.js";
import { reachWords, syncingWords, syncWords, type RowNames } from "../sync/rowWords.js";

/**
 * The shared error banner. Every state in the app row is momentary (owner,
 * 2026-10-04): it has no close key, and it leaves when another message replaces
 * it, the owning action clears it, its expiry passes (`noticeExpiryMs`), or -
 * for a claim about a link - the machine's own answers retire it.
 *
 * A few transport/reconnect failures are noisy but usually self-heal after the
 * next retry or a sessiond restart. Those still deserve visibility, but not a
 * full red "something is broken forever" treatment that steals the whole top of
 * the phone UI.
 */
/**
 * What the app row shows. A sync state - "Trying to reach p…", "Trying to sync with m…",
 * "Syncing with m…" - is the top progress bar alone (owner, 2026-10-19: "no more Syncing and Trying
 * to sync, the loading bar is enough, like the one that sweeps across the top while a session
 * opens"); its sentence is kept for assistive technology only. Any other notice is text in the row.
 */
export type RowView =
  | { readonly kind: "bar"; readonly sentence: string }
  | { readonly kind: "text"; readonly text: string; readonly transient: boolean };

function barView(sentence: string): RowView {
  return { kind: "bar", sentence };
}

function transientText(text: string): RowView {
  return { kind: "text", text, transient: true };
}

/**
 * The row's view of a failure that claims the link is down (B16): the top bar, since it heals by
 * itself; its sentence is only spoken. Any other failure keeps its own words as row text, so "Update failed: …" is never presented
 * as a self-healing hiccup and the operation the reader needs to retry stays named.
 */
const TRANSPORT_VIEW: Readonly<Record<TransportClaim, (names: RowNames) => RowView>> = {
  "daemon-not-listening": (names) => barView(syncWords(names.machine)),
  "machine-unreachable": (names) => barView(syncWords(names.machine)),
  network: (names) => barView(reachWords(names.page)),
  deadline: (names) => barView(reachWords(names.page)),
  aborted: () => transientText("Previous request was interrupted. Retry if the message did not finish."),
  "server-error": () => transientText("Connection problem. Retrying in the background…"),
};

/**
 * The row's view of the one notice. A reply-retired notice with no transport claim is the page's
 * own "Trying to sync with m… <evidence>" about a machine (machineController): the link-down claim
 * and its evidence are one transient state, retired by that machine's next answer, so the whole
 * sentence is the bar's spoken text. A reader-retired notice is a failure the reader must read.
 */
export function noticeRowView(
  error: string,
  claim: TransportClaim | undefined,
  names: RowNames,
  selfHealing = false,
): RowView | null {
  if (error === "") return null;
  if (claim !== undefined) return TRANSPORT_VIEW[claim](names);
  return selfHealing ? barView(error) : { kind: "text", text: error, transient: false };
}

/**
 * The app row is a sync light, not a control (owner, 2026-10-13: "the sync row must not carry any
 * button; it is not there to be interacted with"). The page keeps trying until it is in step, so
 * nothing here is pressed: no Retry, no dismiss. A notice that heals by itself wears the row's sync
 * colour. A sync state draws nothing here: the shell draws it as the top bar.
 */
export function appRowText(view: RowView | null): TemplateResult | null {
  if (view === null || view.kind === "bar") return null;
  return html`<div class=${`error${view.transient ? " transient" : ""}`} role=${view.transient ? "status" : "alert"}>
    <span class="error-text">${view.text}</span>
  </div>`;
}

type MissKind = ReadMiss["kind"];
type MissOf<K extends MissKind> = Extract<ReadMiss, { kind: K }>;
type MachineName = (machineId: string) => string;

/** The row's view of each miss (object model §2.3); a machine is named, and a server error keeps its own words (owner Q9). */
const UNANSWERED_VIEW: { readonly [K in MissKind]: (miss: MissOf<K>, nameOf: MachineName) => RowView } = {
  "link-down": (_miss, nameOf) => barView(reachWords(nameOf("local"))),
  "machine-unanswering": (miss, nameOf) => barView(syncWords(nameOf(miss.machineId))),
  "server-error": (miss, nameOf) => transientText(`${nameOf(miss.machineId)}: ${miss.reason}`),
  "attachments-unreadable": (miss, nameOf) => transientText(`A message for ${nameOf(miss.machineId)} is waiting: this browser cannot read its attachments right now. It keeps trying.`),
};

/**
 * The app row while a read for the machine in use goes unanswered (B48),
 * saying why. It has no cross and no expiry: it leaves when an answer comes,
 * and the page retries by itself, so there is nothing to press (owner,
 * 2026-09-30).
 */
export function unansweredRowView<K extends MissKind>(miss: MissOf<K>, nameOf: MachineName): RowView {
  const view: (miss: MissOf<K>, nameOf: MachineName) => RowView = UNANSWERED_VIEW[miss.kind];
  return view(miss, nameOf);
}

/** The app row while the page fetches what it knows it missed from a machine (owner, 2026-10-14). */
export function syncingRowView(machineName: string): RowView {
  return barView(syncingWords(machineName));
}


/**
 * How long a self-healing message stays before it withdraws itself.
 *
 * Long enough to read at a glance, short enough that a reconnect notice does
 * not outlive the reconnect it describes.
 */
export const TRANSIENT_ERROR_TIMEOUT_MS = 6000;

/** How long a notice about one operation stays: long enough to read. */
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
