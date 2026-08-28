import { html, type TemplateResult } from "lit";
import { CORE_STATUS_FLAGS, type StatusFlags } from "../../../shared/machineStatus";

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

/**
 * Map a status node's flags onto the row's work mark.
 *
 * sessiond rolls the tree up, so a node can carry a flag id this build does
 * not know; such a flag must still light the row rather than blank it, hence
 * the generic session mark. Unread is an attention flag, not work, so it never
 * claims the mark here — call sites pass it to the renderers as a label.
 */
export function statusActivityKind(flags: StatusFlags | undefined): ActivityIndicatorKind | undefined {
  if (flags === undefined) return undefined;
  if (flags[CORE_STATUS_FLAGS.working] === true) return "session";
  if (flags[CORE_STATUS_FLAGS.terminal] === true) return "terminal";
  const hasOtherFlag = Object.entries(flags).some(([flagId, isSet]) => isSet && flagId !== CORE_STATUS_FLAGS.unread);
  return hasOtherFlag ? "session" : undefined;
}

/** Whether a status node carries unread work below it. */
export function hasStatusUnread(flags: StatusFlags | undefined): boolean {
  return flags?.[CORE_STATUS_FLAGS.unread] === true;
}


/**
 * Four-state session badge, shared by list rows, the quick switcher, and the
 * chat dock so every surface tells the same story about a session:
 *
 *   working    -> three bouncing dots (the AI is generating/tooling right now)
 *   background -> hollow purple ring (the turn ended, but subagents or
 *                 background tasks this session started are still running)
 *   idle       -> static green dot (done; nothing in flight)
 *   asking     -> amber dot (an ask_user question set is waiting on the user)
 *   error      -> red dot (activity phase error, e.g. a model error)
 *
 * Background is hollow rather than filled on purpose: the session is not
 * working, so it must not look like it is. Nothing there will advance the
 * conversation on its own.
 *
 * The old single pulse-on-green dot could not express "done" (a finished
 * session never stopped pulsing) or "waiting on me" (an ask looked identical
 * to work). Unread still wins as a separate attention ring, exactly like the
 * work indicators above.
 */
export type SessionStateBadgeKind = "working" | "background" | "idle" | "asking" | "error";

export const SESSION_STATE_LABELS: Record<SessionStateBadgeKind, string> = {
  working: "Session is working",
  background: "Turn ended; background work still running",
  idle: "Session is done",
  asking: "Waiting for your answer",
  error: "Session hit an error",
};

export function renderSessionStateBadge(kind: SessionStateBadgeKind | "sending" | undefined, unreadLabel?: string): TemplateResult | undefined {
  if (kind === undefined) {
    if (unreadLabel === undefined) return undefined;
    return html`<span class="session-state unread" role="img" aria-label=${unreadLabel} title=${unreadLabel}></span>`;
  }
  const label = kind === "sending" ? "Sending message" : SESSION_STATE_LABELS[kind];
  const combined = unreadLabel === undefined ? label : `${unreadLabel} · ${label}`;
  if (kind === "idle") {
    // Idle: gray dot when read, green dot when unread — the color itself says
    // "done; seen (or not)", so no attention ring is needed on this state.
    const className = unreadLabel === undefined ? "session-state idle" : "session-state idle unread";
    return html`<span class=${className} role="img" aria-label=${combined} title=${combined}></span>`;
  }
  if (kind === "working" || kind === "sending") {
    // Three dots instead of one: an animation on a single dot cannot say
    // "working" because the same bounce was used for nothing at all.
    const dots = kind === "working" ? [0, 1, 2].map((i) => html`<span class="state-dot working-dot" style=${`animation-delay:${(i * 0.14).toFixed(2)}s`}></span>`) : null;
    const content = unreadLabel === undefined
      ? html`<span class="session-state working" role="img" aria-label=${label} title=${label}><span class="state-dots">${dots}</span></span>`
      : html`<span class="unread-ring" role="img" aria-label=${combined} title=${combined}><span class="session-state working" aria-hidden="true"><span class="state-dots">${dots}</span></span></span>`;
    return content;
  }
  if (unreadLabel === undefined) {
    return html`<span class=${`session-state ${kind}`} role="img" aria-label=${label} title=${label}></span>`;
  }
  return html`<span class="unread-ring" role="img" aria-label=${combined} title=${combined}><span class=${`session-state ${kind}`} aria-hidden="true"></span></span>`;
}

export function renderActionActivityIndicator(kind: ActivityIndicatorKind | undefined, label = "Active", unreadLabel?: string): TemplateResult | undefined {
  const indicator = renderActivityIndicator(kind, label, unreadLabel);
  if (indicator === undefined) return undefined;
  return html`<span class="action-activity">${indicator}</span>`;
}
