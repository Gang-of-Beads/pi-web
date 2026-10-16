import { LitElement, css, html, nothing } from "lit";
import { barKeyStyles } from "./panelHeaderStyles";
import { customElement, property } from "lit/decorators.js";
import type { SessionInfo } from "../../api";
import { sessionLabel } from "../../sessionLabels";
import { renderBackIcon, renderGridIcon, renderMenuIcon } from "../uiIcons";
import { LongPressTracker } from "../../longPress";

/** The resident row opens navigation and names the session; state belongs in the dock and footer. */
@customElement("app-context-bar")
export class AppContextBar extends LitElement {
  @property({ attribute: false }) session?: SessionInfo;
  /** The tool surface the reader is on ("Files", "Terminal", …), empty on the chat. */
  @property({ type: String }) activeSurface = "";
  /** The project a session not yet started will start in, named beside its title; empty once it has started. */
  @property({ type: String }) startsIn = "";
  /** Whether the collapsible panel is currently presented. */
  @property({ type: Boolean }) panelOpen = false;
  /** What the leading control opens: the side panel, or the session menu the
   *  phone reaches from this bar. The icon is a menu glyph either way, so the
   *  words have to say which surface answers it. */
  @property({ type: String }) toggleTarget: "panel" | "menu" = "panel";
  /** What the grid key opens: a panel that stays beside the session, or a page
   *  that takes the screen. Both are navigation; only the words differ. */
  @property({ type: String }) navigationTarget: "panel" | "page" = "panel";
  /**
   * The corner keys each stand in whichever bar holds their corner (cornerKeys). The leading slot
   * holds the grid key, or the Back key over a page, which goes back to the Go to list; a key that
   * stands elsewhere leaves its room so the name stays centred.
   */
  @property({ type: String }) leadingKey: "grid" | "back" | "none" = "grid";
  @property({ type: Boolean }) goToKeyHidden = false;
  /** Over a page, Go to closes the page instead of opening the list. */
  @property({ type: Boolean }) goToCloses = false;
  @property({ attribute: false }) onBack?: () => void;
  @property({ attribute: false }) onTogglePanel?: () => void;
  /** Opens the quick switcher. Absent where another control in this bar owns
   *  that menu, in which case the name is a label and not a target. */
  @property({ attribute: false }) onQuickSwitch?: () => void;
  /**
   * The scope picker, on the title's plain click.
   *
   * The title's aria-label has said "Open session selection" all along, and the
   * context sheet - which lists projects and workspaces with the current one
   * marked - had no opener at all: `openContextSheet()` was called by nothing, so
   * the reader could not reach it. Falls back to the quick switcher for a host
   * that has not provided one.
   */
  @property({ attribute: false }) onOpenContext?: () => void;
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
    const toggleLabel = this.toggleTarget === "menu" ? (this.goToCloses ? "Close this page" : "Go to a view") : this.panelOpen ? "Close panel" : "Open panel";
    return html`
      <nav class="context-bar" aria-label="Current session">
        ${this.renderLeadingKey()}
        ${this.session === undefined
          ? this.onQuickSwitch === undefined
            ? html`<span class="session-title empty"><span class="session-title-text">${this.activeSurface === "" ? "Sessions" : this.activeSurface}</span></span>`
            : html`<button
              type="button"
              class="session-title empty"
              aria-label="No session selected. Open session selection."
              @click=${() => { (this.onOpenContext ?? this.onQuickSwitch)?.(); }}
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
            ><span class="session-title-text">${this.titleText(this.session)}</span></span>`
          : html`<button
              type="button"
              class="session-title"
              title=${this.session.path}
              aria-label=${`Session: ${sessionLabel(this.session)}. Open session selection.${this.onRenameRequest === undefined ? "" : " Hold to rename."}`}
              @click=${() => { if (this.titleHold.consumeSuppressedClick()) return; (this.onOpenContext ?? this.onQuickSwitch)?.(); }}
              @pointerdown=${(event: PointerEvent) => { if (event.pointerType !== "mouse" && this.onRenameRequest !== undefined) this.titleHold.start(event); }}
              @pointermove=${(event: PointerEvent) => { this.titleHold.move(event); }}
              @pointerup=${() => { this.titleHold.cancel(); }}
              @pointercancel=${() => { this.titleHold.cancel(); }}
              @contextmenu=${(event: Event) => { if (this.onRenameRequest !== undefined) event.preventDefault(); }}
            ><span class="session-title-text">${this.titleText(this.session)}</span></button>`}
        ${this.goToKeyHidden ? html`<span class="key-space" aria-hidden="true"></span>` : html`
        <button
          type="button"
          class="panel-toggle bar-key"
          data-corner-key="goTo"
          title=${toggleLabel}
          aria-label=${toggleLabel}
          aria-haspopup=${this.toggleTarget === "menu" && !this.goToCloses ? "dialog" : nothing}
          aria-expanded=${this.toggleTarget === "menu" ? nothing : this.panelOpen ? "true" : "false"}
          @click=${() => { if (this.toggleTarget === "menu" && this.onOpenGoTo !== undefined) this.onOpenGoTo(); else this.onTogglePanel?.(); }}
        >
          ${renderMenuIcon()}
        </button>
        `}
      </nav>
    `;
  }

  private renderLeadingKey() {
    if (this.leadingKey === "none") return html`<span class="key-space" aria-hidden="true"></span>`;
    if (this.leadingKey === "back") return html`<button type="button" class="panel-toggle bar-key" data-corner-key="back" title="Back to Go to" aria-label="Back to Go to" @click=${() => { this.onBack?.(); }}>${renderBackIcon()}</button>`;
    const navigationLabel = this.navigationTarget === "page" ? "Open navigation" : this.panelOpen ? "Close navigation panel" : "Open navigation panel";
    return html`
        <button
          type="button"
          class="panel-toggle go-to bar-key"
          data-corner-key="grid"
          title=${navigationLabel}
          aria-label=${navigationLabel}
          aria-haspopup=${this.navigationTarget === "page" ? "dialog" : nothing}
          aria-expanded=${this.navigationTarget === "page" ? nothing : this.panelOpen ? "true" : "false"}
          @click=${() => { this.onTogglePanel?.(); }}
        >${renderGridIcon()}</button>
    `;
  }

  /** The session's name, after the surface it is seen through and before the project it will start in. */
  private titleText(session: SessionInfo): string {
    return [this.activeSurface, sessionLabel(session), this.startsIn].filter((part) => part !== "").join(" · ");
  }

  static override styles = [css`
    :host { position: relative; z-index: var(--pi-layer-sticky); flex: 0 0 auto; min-width: 0; }
    /* Control chrome, not content: buttons and labels here are not copy targets. (T1/T3) */
    :host, :host * { -webkit-user-select: none; user-select: none; }
    :host textarea, :host input, :host [contenteditable] { -webkit-user-select: text; user-select: text; }
    /* The rail header and this bar sit either side of one vertical divider, so
       they share a height: 44px of control plus the 1px rule, measured 45 on
       the rail and 53 here before the padding was taken out of the equation. */
    .context-bar { position: relative; flex: 0 0 auto; min-width: 0; box-sizing: border-box; min-height: var(--pi-panel-header-height); display: flex; align-items: center; gap: var(--pi-space-5); padding: 0 var(--pi-chat-gutter); border-bottom: 1px solid var(--pi-border); background: var(--pi-bg); }
    /* Every bar that can hold a corner key (this one, the navigation page's header, the page
       column's bar, a sheet dropped over this bar) keeps its keys the conversation's gutter from
       the edge, on every layout: a key that moves from bar to bar as a panel opens stands on the
       same spot, and on this bar it lines up with the messages (owner, 2026-10-16: on an iPad the
       keys sat 8px outside the messages). Below 640px the gutter is the bar inset. */
    button { font: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
    @media (pointer: coarse) { button:active { background: var(--pi-surface-hover); } }
    /* Centred between the two keys, the owner's call: the name is the bar's
       subject, not a label hanging off the menu key. */
    .session-title { flex: 1 1 auto; min-width: 0; min-height: var(--pi-panel-header-control-height); display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; overflow: hidden; border: 0; background: none; color: var(--pi-text-bright, var(--pi-text)); padding: 0; font: inherit; line-height: var(--pi-panel-header-control-height); font-weight: var(--pi-weight-strong); text-align: center; text-overflow: ellipsis; white-space: nowrap; }
    .session-title.empty { color: var(--pi-muted); font-weight: var(--pi-weight-medium); }
    .session-title.static { cursor: default; }
    /* text-overflow needs a block box with the text in it: on the flex button
       itself the name was clipped mid-glyph with no ellipsis, while the phone
       scope chip beside it truncated properly. */
    .session-title-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* B35: on a coarse pointer the title keeps its drawn height and a finger reaches 44px, as the
       keys do through barKeyStyles; it clips its text in its own span so the reach is not clipped. */
    @media (pointer: coarse) {
      .session-title { position: relative; overflow: visible; }
      .session-title::after { content: ""; position: absolute; inset: calc((var(--pi-panel-header-control-height) - var(--pi-control-height-touch)) / 2) 0; }
    }
    .session-title:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-inset); }
    @media (hover: hover) { .session-title:hover { color: var(--pi-text-bright); } }
  `, barKeyStyles];
}
