import { html, type TemplateResult } from "lit";
import type { NavStatusFlags } from "@gang-of-beads/pi-web/plugin-api";

/** The flag ids PI WEB itself publishes today; matched against the contract's open flag maps. */
const CORE_STATUS_FLAGS = {
  working: "core:working",
  terminal: "core:terminal",
  unread: "core:unread",
} as const;

/**
 * Work signals a row can show. At most one kind renders at a time; call sites
 * resolve precedence (sending > session > terminal) before rendering.
 */
export type ActivityIndicatorKind = "session" | "terminal" | "sending";

/**
 * Map a status node's flags onto the row's work mark.
 *
 * sessiond rolls the tree up, so a node can carry a flag id this build does
 * not know; such a flag must still light the row rather than blank it, hence
 * the generic session mark. Unread is an attention flag, not work, so it never
 * claims the mark here — call sites pass it to the renderers as a label.
 */
export function statusActivityKind(flags: NavStatusFlags | undefined): ActivityIndicatorKind | undefined {
  if (flags === undefined) return undefined;
  if (flags[CORE_STATUS_FLAGS.working] === true) return "session";
  if (flags[CORE_STATUS_FLAGS.terminal] === true) return "terminal";
  const hasOtherFlag = Object.entries(flags).some(([flagId, isSet]) => isSet && flagId !== CORE_STATUS_FLAGS.unread);
  return hasOtherFlag ? "session" : undefined;
}

/** Whether a status node carries unread work below it. */
export function hasStatusUnread(flags: NavStatusFlags | undefined): boolean {
  return flags?.[CORE_STATUS_FLAGS.unread] === true;
}

export function renderActionActivityIndicator(kind: ActivityIndicatorKind | undefined, label = "Active", unreadLabel?: string): TemplateResult | undefined {
  if (kind === undefined) {
    if (unreadLabel === undefined) return undefined;
    return html`<span class="action-activity"><span class="activity-indicator unread" role="img" aria-label=${unreadLabel} title=${unreadLabel}></span></span>`;
  }
  const indicator = unreadLabel === undefined
    ? html`<span class=${`activity-indicator ${kind}`} role="img" aria-label=${label} title=${label}></span>`
    : html`<span class="unread-ring" role="img" aria-label=${`${unreadLabel} · ${label}`} title=${`${unreadLabel} · ${label}`}><span class=${`activity-indicator ${kind}`} aria-hidden="true"></span></span>`;
  return html`<span class="action-activity">${indicator}</span>`;
}
