import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { SessionInfo } from "../../api";
import { sessionLabel } from "../../sessionLabels";

/**
 * The single resident row of the shell: the panel toggle, the session name,
 * and the working indicator. Everything else lives in the collapsible panel
 * (see `appSurface.ts`), so this row never scrolls, never truncates into
 * unreadability, and never stacks a second bar.
 */
@customElement("app-context-bar")
export class AppContextBar extends LitElement {
  @property({ attribute: false }) session?: SessionInfo;
  /** Whether the session being read has work in progress. */
  @property({ type: Boolean }) isWorking = false;
  /** Whether the collapsible panel is currently presented. */
  @property({ type: Boolean }) panelOpen = false;
  /** Hidden when the panel is the whole view (phone with no session): a toggle would advertise closing the only surface. */
  @property({ type: Boolean }) panelToggleHidden = false;
  @property({ attribute: false }) onTogglePanel?: () => void;
  /** Opens the quick switcher: the one pointer path to switching sessions. */
  @property({ attribute: false }) onQuickSwitch?: () => void;

  override render() {
    return html`
      <nav class="context-bar" aria-label="Current session">
        ${this.panelToggleHidden ? null : html`
        <button
          type="button"
          class="panel-toggle"
          title=${this.panelOpen ? "Close panel" : "Open panel"}
          aria-label=${this.panelOpen ? "Close panel" : "Open panel"}
          aria-expanded=${this.panelOpen ? "true" : "false"}
          @click=${() => { this.onTogglePanel?.(); }}
        >
          <svg class="toggle-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M4 6h16M4 12h16M4 18h16"></path>
          </svg>
        </button>
        `}
        ${this.session === undefined
          ? html`<button
              type="button"
              class="session-title empty"
              aria-label="No session selected. Open session selection."
              @click=${() => { this.onQuickSwitch?.(); }}
            ><span class="session-title-text">Sessions</span></button>`
          : html`<button
              type="button"
              class="session-title"
              title=${this.session.path}
              aria-label=${`Session: ${sessionContextLabel(this.session)}. Open session selection.`}
              @click=${() => { this.onQuickSwitch?.(); }}
            ><span class="session-title-text">${sessionContextLabel(this.session)}</span></button>`}
        ${this.isWorking
          ? html`<span
              class="working"
              role="status"
              aria-label="Session is working"
              title="Session is working"
            ><span class="working-dot"></span><span class="working-dot"></span><span class="working-dot"></span></span>`
          : null}
      </nav>
    `;
  }

  static override styles = css`
    :host { position: relative; z-index: var(--pi-layer-sticky); flex: 0 0 auto; min-width: 0; }
    /* The rail header and this bar sit either side of one vertical divider, so
       they share a height: 44px of control plus the 1px rule, measured 45 on
       the rail and 53 here before the padding was taken out of the equation. */
    .context-bar { position: relative; flex: 0 0 auto; min-width: 0; box-sizing: border-box; min-height: var(--pi-panel-header-height); display: flex; align-items: center; gap: var(--pi-space-2); padding: 0 var(--pi-chrome-inset); border-bottom: 1px solid var(--pi-border); background: var(--pi-bg); }
    button { cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
    .panel-toggle { flex: 0 0 auto; display: grid; place-items: center; box-sizing: border-box; width: var(--pi-control-height-touch); height: var(--pi-control-height-touch); padding: 0; border: 0; border-radius: var(--pi-radius-lg); background: transparent; color: var(--pi-text); }
    .panel-toggle:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-inset); }
    @media (hover: hover) { .panel-toggle:hover { background: var(--pi-surface-hover); } }
    .toggle-icon { width: 16px; height: 16px; pointer-events: none; }
    .session-title { padding-inline: 0; flex: 1 1 auto; min-width: 0; min-height: var(--pi-control-height-touch); display: inline-flex; align-items: center; box-sizing: border-box; overflow: hidden; border: 0; background: none; color: var(--pi-text-bright, var(--pi-text)); padding: var(--pi-space-2) var(--pi-space-2); font: inherit; font-weight: var(--pi-weight-strong); text-align: start; text-overflow: ellipsis; white-space: nowrap; }
    .session-title.empty { color: var(--pi-muted); font-weight: var(--pi-weight-medium); }
    /* text-overflow needs a block box with the text in it: on the flex button
       itself the name was clipped mid-glyph with no ellipsis, while the phone
       scope chip beside it truncated properly. */
    .session-title-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .session-title:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-inset); }
    @media (hover: hover) { .session-title:hover { color: var(--pi-text-bright); } }
    .working { box-sizing: border-box; flex: 0 0 auto; display: inline-flex; align-items: center; gap: var(--pi-space-1); max-height: 100%; min-height: var(--pi-control-height-touch); padding: var(--pi-space-2) var(--pi-space-3); }
    .working-dot { width: var(--pi-dot-xs); height: var(--pi-dot-xs); border-radius: 50%; background: var(--pi-accent, var(--pi-text-bright)); animation: working-bounce 1.2s ease-in-out infinite; }
    .working-dot:nth-child(2) { animation-delay: .2s; }
    .working-dot:nth-child(3) { animation-delay: .4s; }
    @keyframes working-bounce { 0%, 60%, 100% { transform: translateY(0); opacity: .55; } 30% { transform: translateY(-3px); opacity: 1; } }
    @media (prefers-reduced-motion: reduce) {
      .working-dot { animation: none; opacity: .8; }
    }
  `;
}

/**
 * What the resident row calls the session.
 *
 * The fallback chain belongs to `sessionLabels`, so the header and the session
 * list cannot disagree about the name of the same session. This adds only the
 * case the shared helper has no opinion about: no session selected at all.
 */
export function sessionContextLabel(session: SessionInfo | undefined): string {
  return session === undefined ? "No session" : sessionLabel(session);
}
