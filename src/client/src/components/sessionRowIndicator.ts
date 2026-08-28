import { html, type TemplateResult } from "lit";
import { SESSION_STATE_LABELS, type SessionStateBadgeKind } from "./activityBadge";

/**
 * The one indicator a session row may show, and the arbiter that picks it.
 *
 * A row used to compose two marks: the state badge drew the session's work
 * state and unread drew a ring around it, so an unread session that was also
 * working or asking carried two rings in a slot meant for one mark. This
 * module replaces composition with a ranking: from (stateKind, unread) it
 * resolves exactly one indicator, and `renderSessionRowIndicator` renders
 * exactly one element for it — or nothing.
 *
 * Priority and color are decided here and documented here; the CSS classes in
 * sessionStateBadgeStyles.ts implement the same names:
 *
 *   priority  kind        color                    rendered as
 *   1         asking      amber  (--pi-warning)    dot — the same hue as the "Waiting for your answer" chip
 *   2         running     blue   (--pi-accent)     three pulsing dots (working or sending)
 *   3         unread      purple (--pi-purple)     filled dot
 *   4         error       red    (--pi-danger)     dot
 *   5         background  purple (--pi-purple)     hollow ring
 *   6         idle        gray   (--pi-dim)        dot
 *   7         (none)      —                        nothing
 *
 * asking > running > unread is the chosen order: an amber ask outranks the
 * work that produced it, and work in progress outranks the "a turn ended and
 * you have not seen it" flag. error, background and idle keep their existing
 * marks for when they are the strongest signal present, but rank below unread:
 * the error phase persists after the reader has seen it, so it is not evidence
 * of anything unseen, while unread is exactly that.
 */
export type SessionRowIndicatorKind = "asking" | "running" | "unread" | "error" | "background" | "idle";

export interface SessionRowIndicator {
  readonly kind: SessionRowIndicatorKind;
  /** What the mark says to a reader, used for aria-label and title. */
  readonly label: string;
}

const UNREAD_LABEL = "Unread session activity";

/**
 * Resolve the single indicator a session row shows, or undefined when the row
 * shows nothing. Pure so the ranking can be pinned by tests without rendering.
 */
export function sessionRowIndicator(
  stateKind: SessionStateBadgeKind | "sending" | undefined,
  unread: boolean,
): SessionRowIndicator | undefined {
  if (stateKind === "asking") return { kind: "asking", label: SESSION_STATE_LABELS.asking };
  if (stateKind === "working") return { kind: "running", label: SESSION_STATE_LABELS.working };
  if (stateKind === "sending") return { kind: "running", label: "Sending message" };
  if (unread) return { kind: "unread", label: UNREAD_LABEL };
  if (stateKind === "error") return { kind: "error", label: SESSION_STATE_LABELS.error };
  if (stateKind === "background") return { kind: "background", label: SESSION_STATE_LABELS.background };
  if (stateKind === "idle") return { kind: "idle", label: SESSION_STATE_LABELS.idle };
  return undefined;
}

/**
 * Render the one indicator. Every kind is a single element; running reuses the
 * bouncing state dots, which carry the blue and the pulse.
 */
export function renderSessionRowIndicator(indicator: SessionRowIndicator | undefined): TemplateResult | undefined {
  if (indicator === undefined) return undefined;
  if (indicator.kind === "running") {
    const dots = [0, 1, 2].map((i) => html`<span class="state-dot" style=${`animation-delay:${(i * 0.14).toFixed(2)}s`}></span>`);
    return html`<span class="session-state running" role="img" aria-label=${indicator.label} title=${indicator.label}><span class="state-dots">${dots}</span></span>`;
  }
  return html`<span class=${`session-state ${indicator.kind}`} role="img" aria-label=${indicator.label} title=${indicator.label}></span>`;
}
