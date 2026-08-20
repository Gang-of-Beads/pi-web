import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { AppState } from "../../appState";
import { renderAppTabIcon, type AppTabBuiltinIcon } from "../tabIcons";
import "../ModalSurface";

export type AppMobileViewIcon = AppTabBuiltinIcon | TemplateResult;

/** One destination in the views sheet: a main view with a name and a badge. */
export interface AppMobileView {
  id: AppState["mainView"];
  label: string;
  icon?: AppMobileViewIcon;
  badge?: unknown;
  badgeLabel?: string | undefined;
  badgeTone?: "unread" | undefined;
  className?: string | undefined;
}

/**
 * The workspace views, as a list you can read.
 *
 * They used to be a strip of icon buttons pinned above the content: eight
 * unlabelled glyphs that scrolled sideways, cost 57px of a phone screen on
 * every surface, and hid the terminal behind a picture. Reaching for a view is
 * not frequent enough to pay that rent, and it is exactly the kind of thing
 * that needs a name rather than a symbol.
 *
 * So it becomes a sheet: opened from one control, each view on its own row with
 * its title, its badge, and a check on the current one. Being a modal layer,
 * the system back gesture closes it a level at a time.
 */
@customElement("app-mobile-tool-sheet")
export class AppMobileToolSheet extends LitElement {
  @property({ attribute: false }) tabs: readonly AppMobileView[] = [];
  @property({ attribute: false }) selectedView?: AppMobileView["id"];
  @property({ attribute: false }) onSelect?: (id: AppMobileView["id"]) => void;
  @property({ attribute: false }) onClose?: () => void;

  override render() {
    return html`
      <modal-surface .onClose=${() => this.onClose?.()} .label=${"Views"} .initialFocus=${"button"}>
        <header><h2>Go to</h2></header>
        <div class="body">
          ${this.tabs.map((tab) => this.renderTab(tab))}
        </div>
      </modal-surface>
    `;
  }

  private renderTab(tab: AppMobileView) {
    const current = this.selectedView === tab.id;
    return html`
      <button
        type="button"
        class=${current ? "tool current" : "tool"}
        aria-current=${current ? "true" : "false"}
        @click=${() => { this.onSelect?.(tab.id); this.onClose?.(); }}
      >
        <span class="tool-icon" aria-hidden="true">${tab.icon === undefined ? nothing : renderAppTabIcon(tab.icon)}</span>
        <span class="tool-label">${tab.label}</span>
        ${this.renderBadge(tab)}
        ${current ? html`<span class="tool-check" aria-hidden="true">✓</span>` : nothing}
      </button>
    `;
  }

  /**
   * A badge comes from a plugin, so it is `unknown`. Only a string or a number
   * is renderable; anything else would print as "[object Object]", which says
   * less than nothing.
   */
  private renderBadge(tab: AppMobileView) {
    const badge = tab.badge;
    if (typeof badge !== "string" && typeof badge !== "number") return nothing;
    if (badge === 0 || badge === "") return nothing;
    const text = String(badge);
    return html`<span class=${`tool-badge ${tab.badgeTone ?? ""}`} aria-label=${tab.badgeLabel ?? text}>${text}</span>`;
  }

  static override styles = css`
    :host { position: fixed; inset: 0; z-index: 26; color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui); }
    modal-surface {
      --modal-surface-place-items: end center;
      --modal-surface-backdrop-padding: 0;
      --modal-surface-width: min(560px, 100vw);
      --modal-surface-max-height: min(70dvh, 560px);
    }
    header { padding: var(--pi-space-6) var(--pi-space-7) var(--pi-space-3); }
    h2 { margin: 0; font-size: var(--pi-text-sm); color: var(--pi-muted); text-transform: uppercase; letter-spacing: .04em; }
    .body { flex: 1 1 auto; min-height: 0; overflow: auto; display: grid; gap: var(--pi-space-3); padding: var(--pi-space-4) var(--pi-space-5); padding-bottom: max(10px, env(safe-area-inset-bottom)); overscroll-behavior: contain; }
    .tool { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto auto; align-items: center; gap: var(--pi-space-5); min-height: 52px; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-4) var(--pi-space-6); font: inherit; text-align: left; cursor: pointer; touch-action: manipulation; }
    .tool.current { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
    .tool:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: 1px; }
    .tool-icon { display: inline-grid; place-items: center; color: var(--pi-muted); }
    .tool.current .tool-icon { color: var(--pi-accent); }
    .tool-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--pi-text-md); }
    .tool-badge { min-width: 20px; border-radius: var(--pi-radius-pill); background: var(--pi-surface-hover); color: var(--pi-text-secondary); padding: 1px var(--pi-space-4); font-size: var(--pi-text-xs); text-align: center; }
    .tool-badge.unread { background: var(--pi-selection-bg); color: var(--pi-accent); }
    .tool-check { color: var(--pi-accent); }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "app-mobile-tool-sheet": AppMobileToolSheet;
  }
}
