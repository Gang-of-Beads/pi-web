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

function normalizeTransientError(error: string): string | undefined {
  if (/session daemon workspace authority unavailable: connect enoent/i.test(error) && /sessiond\.sock/i.test(error)) {
    return "Reconnecting to the session daemon…";
  }
  if (/model response failed: this operation was aborted/i.test(error)) {
    return "Previous request was interrupted. Retry if the message did not finish.";
  }
  if (/remote machine request cancelled/i.test(error)) {
    return "Connection changed while the request was in flight. Retrying is usually enough.";
  }
  return undefined;
}
