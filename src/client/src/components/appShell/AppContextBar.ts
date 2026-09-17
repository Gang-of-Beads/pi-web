import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { SessionInfo } from "../../api";
import { sessionLabel } from "../../sessionLabels";
import { renderGridIcon } from "../uiIcons";
import { LongPressTracker } from "../../longPress";

/**
 * The single resident row of the shell: the panel toggle, the session name,
 * and the working indicator. Everything else lives in the collapsible panel
 * (see `appSurface.ts`), so this row never scrolls, never truncates into
 * unreadability, and never stacks a second bar.
 */
@customElement("app-context-bar")
export class AppContextBar extends LitElement {
  @property({ attribute: false }) session?: SessionInfo;
  /** The tool surface the reader is on ("Files", "Terminal", …), empty on the chat. */
  @property({ type: String }) activeSurface = "";
  /** Whether the session being read has work in progress. */
  @property({ type: Boolean }) isWorking = false;
  /** Whether the collapsible panel is currently presented. */
  @property({ type: Boolean }) panelOpen = false;
  /** What the leading control opens: the side panel, or the session menu the
   *  phone reaches from this bar. The icon is a menu glyph either way, so the
   *  words have to say which surface answers it. */
  @property({ type: String }) toggleTarget: "panel" | "menu" = "panel";
  /** Hidden when the panel is the whole view (phone with no session): a toggle would advertise closing the only surface. */
  @property({ type: Boolean }) panelToggleHidden = false;
  @property({ attribute: false }) onTogglePanel?: () => void;
  /** Opens the quick switcher. Absent where another control in this bar owns
   *  that menu, in which case the name is a label and not a target. */
  @property({ attribute: false }) onQuickSwitch?: () => void;
  /** Opens the Go to sheet; absent on layouts where the navigation panel lists the views itself. */
  @property({ attribute: false }) onOpenGoTo?: () => void;
  /** Holding the session name asks to rename it; absent where the shell offers no rename. */
  @property({ attribute: false }) onRenameRequest?: (session: SessionInfo) => void;
  private readonly titleHold = new LongPressTracker({
    onLongPress: () => { if (this.session !== undefined) this.onRenameRequest?.(this.session); },
    setTimer: (callback, ms) => window.setTimeout(callback, ms),
    clearTimer: (handle) => { window.clearTimeout(handle); },
  });

  override render() {
    return html`
      <nav class="context-bar" aria-label="Current session">
        ${this.panelToggleHidden ? null : html`
        <button
          type="button"
          class="panel-toggle"
          title=${panelToggleLabel(this.toggleTarget, this.panelOpen)}
          aria-label=${panelToggleLabel(this.toggleTarget, this.panelOpen)}
          aria-haspopup=${this.toggleTarget === "menu" ? "dialog" : nothing}
          aria-expanded=${this.toggleTarget === "menu" ? nothing : this.panelOpen ? "true" : "false"}
          @click=${() => { this.onTogglePanel?.(); }}
        >
          <svg class="toggle-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M4 6h16M4 12h16M4 18h16"></path>
          </svg>
        </button>
        `}
        ${this.session === undefined
          ? this.onQuickSwitch === undefined
            ? html`<span class="session-title empty"><span class="session-title-text">${this.activeSurface === "" ? "Sessions" : this.activeSurface}</span></span>`
            : html`<button
              type="button"
              class="session-title empty"
              aria-label="No session selected. Open session selection."
              @click=${() => { this.onQuickSwitch?.(); }}
            ><span class="session-title-text">${this.activeSurface === "" ? "Sessions" : this.activeSurface}</span></button>`
          : this.onQuickSwitch === undefined
          ? html`<span
              class="session-title static"
              title=${this.session.path}
              @pointerdown=${(event: PointerEvent) => { if (event.pointerType !== "mouse" && this.onRenameRequest !== undefined) this.titleHold.start(event); }}
              @pointermove=${(event: PointerEvent) => { this.titleHold.move(event); }}
              @pointerup=${() => { this.titleHold.cancel(); }}
              @pointercancel=${() => { this.titleHold.cancel(); }}
              @contextmenu=${(event: Event) => { if (this.onRenameRequest !== undefined) event.preventDefault(); }}
            ><span class="session-title-text">${this.activeSurface === "" ? sessionContextLabel(this.session) : `${this.activeSurface} · ${sessionContextLabel(this.session)}`}</span></span>`
          : html`<button
              type="button"
              class="session-title"
              title=${this.session.path}
              aria-label=${`Session: ${sessionContextLabel(this.session)}. Open session selection.${this.onRenameRequest === undefined ? "" : " Hold to rename."}`}
              @click=${() => { if (this.titleHold.consumeSuppressedClick()) return; this.onQuickSwitch?.(); }}
              @pointerdown=${(event: PointerEvent) => { if (event.pointerType !== "mouse" && this.onRenameRequest !== undefined) this.titleHold.start(event); }}
              @pointermove=${(event: PointerEvent) => { this.titleHold.move(event); }}
              @pointerup=${() => { this.titleHold.cancel(); }}
              @pointercancel=${() => { this.titleHold.cancel(); }}
              @contextmenu=${(event: Event) => { if (this.onRenameRequest !== undefined) event.preventDefault(); }}
            ><span class="session-title-text">${this.activeSurface === "" ? sessionContextLabel(this.session) : `${this.activeSurface} · ${sessionContextLabel(this.session)}`}</span></button>`}
        <span
          class="working"
          role="status"
          aria-label=${this.isWorking ? "Session is working" : ""}
          title=${this.isWorking ? "Session is working" : ""}
          ?hidden=${!this.isWorking}
        ><span class="working-dot"></span><span class="working-dot"></span><span class="working-dot"></span></span>
        ${this.onOpenGoTo === undefined ? null : html`
        <button
          type="button"
          class="panel-toggle go-to"
          title="Go to a view"
          aria-label="Go to a view"
          aria-haspopup="dialog"
          @click=${() => { this.onOpenGoTo?.(); }}
        >${renderGridIcon()}</button>
        `}
      </nav>
    `;
  }

  static override styles = css`
    :host { position: relative; z-index: var(--pi-layer-sticky); flex: 0 0 auto; min-width: 0; }
    /* Control chrome, not content: buttons and labels here are not copy targets. (T1/T3) */
    :host, :host * { -webkit-user-select: none; user-select: none; }
    :host textarea, :host input, :host [contenteditable] { -webkit-user-select: text; user-select: text; }
    /* The rail header and this bar sit either side of one vertical divider, so
       they share a height: 44px of control plus the 1px rule, measured 45 on
       the rail and 53 here before the padding was taken out of the equation. */
    .context-bar { position: relative; flex: 0 0 auto; min-width: 0; box-sizing: border-box; min-height: var(--pi-panel-header-height); display: flex; align-items: center; gap: var(--pi-space-2); padding: 0 var(--pi-bar-inset); border-bottom: 1px solid var(--pi-border); background: var(--pi-bg); }
    button { font: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
    @media (pointer: coarse) { button:active { background: var(--pi-surface-hover); } }
    .panel-toggle { flex: 0 0 auto; display: grid; place-items: center; box-sizing: border-box; width: var(--pi-panel-header-control-height); height: var(--pi-panel-header-control-height); padding: 0; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); }
    .panel-toggle:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-inset); }
    @media (hover: hover) { .panel-toggle:hover { background: var(--pi-surface-hover); } }
    .toggle-icon { width: 16px; height: 16px; pointer-events: none; }
    .go-to .ui-icon { width: 18px; height: 18px; pointer-events: none; }
    .session-title { flex: 1 1 auto; min-width: 0; min-height: var(--pi-panel-header-control-height); display: inline-flex; align-items: center; box-sizing: border-box; overflow: hidden; border: 0; background: none; color: var(--pi-text-bright, var(--pi-text)); padding: 0; font: inherit; line-height: var(--pi-panel-header-control-height); font-weight: var(--pi-weight-strong); text-align: start; text-overflow: ellipsis; white-space: nowrap; }
    .session-title.empty { color: var(--pi-muted); font-weight: var(--pi-weight-medium); }
    .session-title.static { cursor: default; }
    /* text-overflow needs a block box with the text in it: on the flex button
       itself the name was clipped mid-glyph with no ellipsis, while the phone
       scope chip beside it truncated properly. */
    .session-title-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .session-title:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-inset); }
    @media (hover: hover) { .session-title:hover { color: var(--pi-text-bright); } }
    /* The wrapper is persistent and toggled with [hidden]; an author display
       rule beats the UA sheet's [hidden] rule, so the hidden state must be
       restated or an idle session wears three bouncing dots forever. */
    .working[hidden] { display: none; }
    .working { box-sizing: border-box; flex: 0 0 auto; display: inline-flex; align-items: center; gap: var(--pi-space-1); max-height: 100%; min-height: var(--pi-panel-header-control-height); padding: var(--pi-space-2) var(--pi-space-3); }
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
/**
 * What the leading control promises. A menu key that says "Open panel" and
 * then covers the screen with another surface is the mismatch the owner
 * reported; the words follow the surface the tap actually opens.
 */
export function panelToggleLabel(target: "panel" | "menu", panelOpen: boolean): string {
  if (target === "menu") return "Open session menu";
  return panelOpen ? "Close panel" : "Open panel";
}

export function sessionContextLabel(session: SessionInfo | undefined): string {
  return session === undefined ? "No session" : sessionLabel(session);
}
