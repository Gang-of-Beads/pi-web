import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import "../ModalSurface";
import type { Project } from "../../api";
import { interactiveSurfaceStyles } from "../shared";
import { renderCrossIcon, uiIconStyle } from "../uiIcons";

/**
 * Where a new session starts, asked when no project is open (owner, 2026-10-13). Sending the
 * reader to the Projects list did not say what it was for: the page changed, and nothing said a
 * project was wanted. This sheet says it in its title, lists the machine's projects, and offers a
 * new project; choosing one opens an empty chat there, and the session is created by its first
 * message. A machine with no projects says so above the one way forward.
 */
@customElement("new-session-project-sheet")
export class NewSessionProjectSheet extends LitElement {
  @property({ attribute: false }) projects: readonly Project[] = [];
  @property({ type: Boolean }) canAddProject = false;
  @property({ attribute: false }) onChoose?: (project: Project) => void;
  @property({ attribute: false }) onAddProject?: () => void;
  @property({ attribute: false }) onClose?: () => void;

  override render() {
    return html`
      <modal-surface .onClose=${() => this.onClose?.()} .label=${"New session in"} .initialFocus=${"button"}>
        <header class="panel-header">
          <h2 class="panel-header-title">New session in…</h2>
          <button type="button" class="panel-key" title="Close" aria-label="Close" @click=${() => { this.onClose?.(); }}>${renderCrossIcon()}</button>
        </header>
        <div class="body">
          ${this.projects.length === 0 ? html`<p class="empty">This machine has no projects yet.</p>` : html`<div class="rows" role="list">
            ${this.projects.map((project) => html`
              <button type="button" role="listitem" class="row" title=${project.path} @click=${() => { this.onChoose?.(project); }}>
                <span class="row-name">${project.name}</span>
                <span class="row-path">${project.path}</span>
              </button>
            `)}
          </div>`}
          ${this.canAddProject ? html`<button type="button" class="row add" @click=${() => { this.onAddProject?.(); }}><span class="row-name">New project…</span></button>` : nothing}
        </div>
      </modal-surface>
    `;
  }

  static override styles = [css`${unsafeCSS(uiIconStyle)}`, interactiveSurfaceStyles, css`
    :host { position: fixed; inset: 0; z-index: var(--pi-layer-overlay); color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui); }
    modal-surface {
      --modal-surface-place-items: start center;
      --modal-surface-backdrop-padding: 0;
      --modal-surface-width: min(560px, 100vw);
      --modal-surface-max-height: min(70dvh, 560px);
    }
    .panel-header { box-sizing: border-box; min-height: var(--pi-panel-header-height); display: flex; align-items: center; padding: 0 var(--pi-bar-inset); border-bottom: 1px solid var(--pi-border); }
    .panel-header-title { margin: 0; font-size: var(--pi-text-sm); font-weight: var(--pi-weight-semibold); line-height: var(--pi-panel-header-control-height); }
    .panel-key { box-sizing: border-box; margin-left: auto; display: grid; place-items: center; width: var(--pi-panel-header-control-height); height: var(--pi-panel-header-control-height); padding: 0; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); cursor: pointer; }
    .panel-key:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-inset); }
    .body { flex: 1 1 auto; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: var(--pi-space-3); padding: var(--pi-space-4) var(--pi-reading-edge); padding-bottom: max(var(--pi-space-4), env(safe-area-inset-bottom)); overscroll-behavior: contain; }
    .rows { display: grid; gap: var(--pi-space-3); }
    .empty { margin: 0; color: var(--pi-muted); }
    .row { display: grid; gap: var(--pi-space-1); box-sizing: border-box; min-height: var(--pi-row-min-height); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-3) var(--pi-space-5); font: inherit; text-align: start; cursor: pointer; }
    .row.add { border-style: dashed; color: var(--pi-accent); align-content: center; }
    .row:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-tight); }
    @media (hover: hover) { .row:hover { background: var(--pi-surface-hover); } }
    @media (pointer: coarse) { .row:active { background: var(--pi-surface-hover); } }
    .row-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--pi-text-md); }
    .row-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--pi-text-xs); color: var(--pi-muted); font-family: var(--pi-font-mono, monospace); }
  `];
}

declare global {
  interface HTMLElementTagNameMap {
    "new-session-project-sheet": NewSessionProjectSheet;
  }
}
