import { html, type TemplateResult } from "lit";

/**
 * Work signals a row can show. At most one kind renders at a time; call sites
 * resolve precedence (sending > session > terminal) before rendering.
 */
export type ActivityIndicatorKind = "session" | "terminal" | "sending";

/**
 * Render the single indicator mark for a row.
 *
 * Unread is an attention flag, not a work signal, so it never competes with
 * the activity kinds for the slot: pass `unreadLabel` and it renders as a
 * static accent ring around the work dot (which keeps its own color, shape,
 * and pulse), or as a filled static accent dot when the row is idle. The label
 * is the flag — pass undefined when the row has nothing unread.
 */
export function renderActivityIndicator(kind: ActivityIndicatorKind | undefined, label = "Active", unreadLabel?: string): TemplateResult | undefined {
  if (kind === undefined) {
    if (unreadLabel === undefined) return undefined;
    return html`<span class="activity-indicator unread" role="img" aria-label=${unreadLabel} title=${unreadLabel}></span>`;
  }
  if (unreadLabel === undefined) {
    return html`<span class=${`activity-indicator ${kind}`} role="img" aria-label=${label} title=${label}></span>`;
  }
  const combinedLabel = `${unreadLabel} · ${label}`;
  return html`<span class="unread-ring" role="img" aria-label=${combinedLabel} title=${combinedLabel}><span class=${`activity-indicator ${kind}`} aria-hidden="true"></span></span>`;
}

export function renderActionActivityIndicator(kind: ActivityIndicatorKind | undefined, label = "Active", unreadLabel?: string): TemplateResult | undefined {
  const indicator = renderActivityIndicator(kind, label, unreadLabel);
  if (indicator === undefined) return undefined;
  return html`<span class="action-activity">${indicator}</span>`;
}
