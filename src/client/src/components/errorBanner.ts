import { html, type TemplateResult } from "lit";

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
export function errorBanner(error: string, onDismiss: () => void): TemplateResult | null {
  if (error === "") return null;
  const transient = normalizeTransientError(error);
  return html`<div class=${`error${transient === undefined ? "" : " transient"}`} role=${transient === undefined ? "alert" : "status"}>
    <span class="error-text">${transient ?? error}</span>
    <button type="button" class="error-dismiss" aria-label="Dismiss error" title="Dismiss error" @click=${() => { onDismiss(); }}>✕</button>
  </div>`;
}

/**
 * Whether a message is one of the self-healing transport failures.
 *
 * Exported so the owner of the banner can let those expire on their own. A
 * permanent failure must never expire: it stays until the user has seen and
 * dismissed it.
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

function normalizeTransientError(error: string): string | undefined {
  // ENOENT when the socket file is gone, ECONNREFUSED while the daemon is
  // restarting and nothing is listening on it yet. The second is the one a user
  // is guaranteed to meet, because it is what an update looks like.
  if (/session daemon workspace authority unavailable: connect (enoent|econnrefused)/i.test(error) && /sessiond\.sock/i.test(error)) {
    return "Reconnecting to the session daemon…";
  }
  // Matches the DOMException text a cancelled fetch stringifies to, with or
  // without a wrapping prefix. The earlier rule required "model response
  // failed:", which only ever prefixes a transcript system line, so it never
  // fired on the banner it was written for.
  if (/\boperation was aborted\b/i.test(error)) {
    return "Previous request was interrupted. Retry if the message did not finish.";
  }
  if (/remote machine request cancelled/i.test(error)) {
    return "Connection changed while the request was in flight. Retrying is usually enough.";
  }
  return undefined;
}
