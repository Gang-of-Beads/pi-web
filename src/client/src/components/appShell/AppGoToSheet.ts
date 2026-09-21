import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import "../ModalSurface";
import { interactiveSurfaceStyles } from "../shared";
import { renderCheckIcon } from "../uiIcons";

/** One destination in the Go to sheet: a main view with a name and a badge. */
export interface GoToDestination {
  id: string;
  label: string;
  icon?: TemplateResult | undefined;
  badge?: string | number | undefined;
  badgeLabel?: string | undefined;
  selected?: boolean | undefined;
}

/**
 * The extension page on the phone: every destination by name in two columns
 * of tiles (the owner's shape), opened from one control in the bar and
 * dropping from the top, under the finger that opened it, so nothing has
 * to travel down the screen to pick. The owner ruled it back in from the 8504 build:
 * the tool tiles stacked under the session list made the list page carry
 * two things, and a tool page had no way to another tool but back through
 * the list. Being a modal layer, the system back gesture closes it.
 */
@customElement("app-go-to-sheet")
export class AppGoToSheet extends LitElement {
  @property({ attribute: false }) destinations: readonly GoToDestination[] = [];
  @property({ attribute: false }) onSelect?: (id: string) => void;
  @property({ attribute: false }) onClose?: () => void;

  override render() {
    return html`
      <modal-surface .onClose=${() => this.onClose?.()} .label=${"Go to"} .initialFocus=${"button"}>
        <header class="panel-header">
          <h2 class="panel-header-title">Go to</h2>
          <button
            type="button"
            class="panel-key"
            title="Close Go to"
            aria-label="Close Go to"
            @click=${() => { this.onClose?.(); }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 6h16M4 12h16M4 18h16"></path>
            </svg>
          </button>
        </header>
        <div class="body" role="list">
          ${this.destinations.map((destination) => this.renderDestination(destination))}
        </div>
      </modal-surface>
    `;
  }

  private renderDestination(destination: GoToDestination) {
    const current = destination.selected === true;
    return html`
      <button
        type="button"
        role="listitem"
        class=${current ? "destination current" : "destination"}
        aria-current=${current ? "true" : "false"}
        @click=${() => { this.onSelect?.(destination.id); this.onClose?.(); }}
      >
        <span class="destination-icon" aria-hidden="true">${destination.icon ?? nothing}</span>
        <span class="destination-label">${destination.label}</span>
        ${destination.badge === undefined || destination.badge === "" || destination.badge === 0 ? nothing : html`<span class="destination-badge" aria-label=${destination.badgeLabel ?? String(destination.badge)}>${destination.badge}</span>`}
        ${current ? html`<span class="destination-check" aria-hidden="true">${renderCheckIcon()}</span>` : nothing}
      </button>
    `;
  }

  static override styles = [interactiveSurfaceStyles, css`
    :host { position: fixed; inset: 0; z-index: var(--pi-layer-overlay); color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui); }
    modal-surface {
      --modal-surface-place-items: start center;
      --modal-surface-backdrop-padding: 0;
      --modal-surface-width: min(560px, 100vw);
      --modal-surface-max-height: min(70dvh, 560px);
    }
    /* The key that opened the sheet keeps its place in it, so a second press
       closes what the first press opened. Without it the sheet had no key at
       all and the gesture had nowhere to land. */
    .panel-key { box-sizing: border-box; flex: 0 0 auto; margin-left: auto; display: grid; place-items: center; width: var(--pi-panel-header-control-height); height: var(--pi-panel-header-control-height); padding: 0; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); cursor: pointer; }
    .panel-key svg { width: 18px; height: 18px; }
    .panel-key:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-inset); }
    @media (hover: hover) { .panel-key:hover { background: var(--pi-surface-hover); } }
    .panel-header { box-sizing: border-box; min-height: var(--pi-panel-header-height); display: flex; align-items: center; padding: 0 var(--pi-bar-inset); border-bottom: 1px solid var(--pi-border); }
    .panel-header-title { margin: 0; font-size: var(--pi-text-sm); font-weight: var(--pi-weight-semibold); color: var(--pi-text); line-height: var(--pi-panel-header-control-height); }
    .body { flex: 1 1 auto; min-height: 0; overflow: auto; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--pi-space-3); padding: var(--pi-space-4) var(--pi-reading-edge); padding-bottom: max(var(--pi-space-4), env(safe-area-inset-bottom)); overscroll-behavior: contain; }
    .destination:last-child:nth-child(odd) { grid-column: 1 / -1; }
    .destination { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto auto; align-items: center; gap: var(--pi-space-4); box-sizing: border-box; min-height: var(--pi-row-min-height); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); color: var(--pi-text); padding: 0 var(--pi-space-5); font: inherit; text-align: start; cursor: pointer; }
    .destination.current { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
    .destination:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-tight); }
    @media (pointer: coarse) { .destination:active { background: var(--pi-surface-hover); } }
    .destination-icon { display: inline-grid; place-items: center; width: 20px; height: 20px; color: var(--pi-muted); }
    .destination-icon svg { width: 100%; height: 100%; }
    .destination.current .destination-icon { color: var(--pi-accent); }
    .destination-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--pi-text-md); }
    .destination-badge { min-width: 20px; border-radius: var(--pi-radius-pill); background: var(--pi-surface-hover); color: var(--pi-text-secondary); padding: 1px var(--pi-space-4); font-size: var(--pi-text-xs); text-align: center; }
    .destination-check { display: inline-grid; place-items: center; color: var(--pi-accent); }
    .destination-check .ui-icon { width: 16px; height: 16px; }
  `];
}

declare global {
  interface HTMLElementTagNameMap {
    "app-go-to-sheet": AppGoToSheet;
  }
}
