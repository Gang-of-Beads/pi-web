import { html, type TemplateResult } from "lit";
import type { RetiredBy } from "../notice.js";
import { renderCrossIcon } from "./uiIcons.js";

/**
 * The shared error banner. It stays until the user dismisses it, another
 * message replaces it, or the owning action clears it, so a background refresh
 * cannot hide a failure the user has not read yet.
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
export function errorBanner(error: string, onDismiss: () => void, retiredBy: RetiredBy = "reply"): TemplateResult | null {
  if (error === "") return null;
  const transient = retiredBy === "reply" ? normalizeTransientError(error) : undefined;
  return html`<div class=${`error${transient === undefined ? "" : " transient"}`} role=${transient === undefined ? "alert" : "status"}>
    <span class="error-text">${transient ?? error}</span>
    <button type="button" class="error-dismiss" aria-label="Dismiss error" title="Dismiss error" @click=${() => { onDismiss(); }}>${renderCrossIcon()}</button>
  </div>`;
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
  // uncomposed claims reach the rewrites below. The composed prefix is the
  // machine controller's own; nothing else produces it.
  const composed = /is unavailable; reconnecting/i.test(error);
  // A TCP-endpoint deployment has no socket path in the error text, so the
  // socket-path requirement missed the same outage there; the daemon's own
  // phrase ("session daemon") carries the identification instead.
  if (!composed && /unavailable: connect (enoent|econnrefused)/i.test(error) && (/sessiond\.sock/i.test(error) || /session daemon/i.test(error))) {
    return "Reconnecting to the session daemon…";
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
    return "A request timed out. Polls retry on their own.";
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
    return "Lost connection to PI WEB. Reconnecting…";
  }
  // The gateway's own two labels, whole-message (its detail arrives inside
  // parentheses). Same claim as the local daemon's: the hop in between is
  // down, and it heals.
  if (/^remote machine (unavailable|timeout)/i.test(error)) {
    return "Reconnecting to the machine…";
  }
  return undefined;
}
