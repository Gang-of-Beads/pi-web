import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import "../ModalSurface";
import type { Project } from "../../api";
import type { ProjectsLoadState } from "../../appState";
import { interactiveSurfaceStyles } from "../shared";
import { renderCrossIcon, renderProjectIcon, uiIconStyle } from "../uiIcons";

/**
 * Where a new session starts, asked whenever no one project is in view (owner, 2026-10-13 and
 * 2026-10-14). Sending the reader to the Projects list did not say what it was for, and starting in
 * the project selected before, unseen, put sessions where the reader did not look. The sheet says
 * what it is for in its title, offers a new project first, and draws the machine's projects as the
 * Projects page does, the one used last first. Choosing one opens an empty chat there, and the
 * session is created by its first message; a new project opens one in itself.
 */
@customElement("new-session-project-sheet")
export class NewSessionProjectSheet extends LitElement {
  @property({ attribute: false }) projects: readonly Project[] = [];
  /** Whether the list is the machine's answer yet: an empty list before it is not "no projects". */
  @property({ attribute: false }) projectsLoad: ProjectsLoadState = "unloaded";
  /** The project of the newest session, drawn first and marked. */
  @property({ attribute: false }) lastUsedId: string | undefined;
  @property({ type: Boolean }) canAddProject = false;
  @property({ attribute: false }) onChoose?: (project: Project) => void;
  @property({ attribute: false }) onAddProject?: () => void;
  @property({ attribute: false }) onClose?: () => void;

  override render() {
    const lastUsed = this.projects.filter((project) => project.id === this.lastUsedId);
    const ordered = [...lastUsed, ...this.projects.filter((project) => project.id !== this.lastUsedId)];
    return html`
      <modal-surface .onClose=${() => this.onClose?.()} .label=${"New session in"} .initialFocus=${"button"}>
        <header class="panel-header">
          <h2 class="panel-header-title">New session in…</h2>
          <button type="button" class="panel-key" title="Close" aria-label="Close" @click=${() => { this.onClose?.(); }}>${renderCrossIcon()}</button>
        </header>
        <div class="body">
          ${this.canAddProject ? html`<button type="button" class="create" @click=${() => { this.onAddProject?.(); }}>+ Add project</button>` : nothing}
          ${ordered.length === 0 ? html`<p class="empty">${this.projectsLoad === "loaded" ? "This machine has no projects yet." : "Reading this machine's projects…"}</p>` : html`<div class="tiles" role="list">
            ${ordered.map((project) => html`
              <button type="button" role="listitem" class=${project.id === this.lastUsedId ? "tile last-used" : "tile"} title=${project.path} @click=${() => { this.onChoose?.(project); }}>
                <span class="tile-title"><span class="tile-icon">${renderProjectIcon()}</span><span class="tile-name">${project.name}</span></span>
                <span class="tile-path">${project.id === this.lastUsedId ? `Last used · ${project.path}` : project.path}</span>
              </button>
            `)}
          </div>`}
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
      --modal-surface-max-height: min(80dvh, 640px);
    }
    .panel-header { box-sizing: border-box; min-height: var(--pi-panel-header-height); display: flex; align-items: center; padding: 0 var(--pi-bar-inset); border-bottom: 1px solid var(--pi-border); }
    .panel-header-title { margin: 0; font-size: var(--pi-text-sm); font-weight: var(--pi-weight-semibold); line-height: var(--pi-panel-header-control-height); }
    .panel-key { box-sizing: border-box; margin-left: auto; display: grid; place-items: center; width: var(--pi-panel-header-control-height); height: var(--pi-panel-header-control-height); padding: 0; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); cursor: pointer; }
    .panel-key:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-inset); }
    .body { flex: 1 1 auto; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: var(--pi-space-3); padding: var(--pi-space-4) var(--pi-reading-edge); padding-bottom: max(var(--pi-space-4), env(safe-area-inset-bottom)); overscroll-behavior: contain; }
    .create { box-sizing: border-box; flex: 0 0 auto; min-height: var(--pi-control-height-comfort); border: 1px solid var(--pi-accent-border); border-radius: var(--pi-radius-md); background: var(--pi-selection-bg); color: var(--pi-text-bright); font: inherit; cursor: pointer; }
    @media (pointer: coarse) { .create { min-height: var(--pi-control-height-touch); } }
    .create:focus-visible, .tile:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-tight); }
    .tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--pi-space-3); }
    .empty { margin: 0; color: var(--pi-muted); }
    .tile { box-sizing: border-box; display: grid; align-content: start; gap: var(--pi-space-2); min-width: 0; min-height: calc(var(--pi-row-min-height, 48px) + var(--pi-space-6)); padding: var(--pi-space-4) var(--pi-space-5); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); font: inherit; text-align: start; cursor: pointer; }
    .tile.last-used { border-color: var(--pi-accent-border); background: var(--pi-selection-bg); }
    @media (hover: hover) { .tile:hover, .create:hover { background: var(--pi-surface-hover); } }
    @media (pointer: coarse) { .tile:active, .create:active { background: var(--pi-surface-hover); } }
    .tile-title { display: flex; align-items: flex-start; gap: var(--pi-space-3); min-width: 0; }
    .tile-icon { display: inline-grid; place-items: center; flex: 0 0 auto; height: 1.3em; color: var(--pi-purple); }
    .tile-icon .ui-icon { width: 14px; height: 14px; }
    .tile-name { min-width: 0; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; min-height: calc(2 * 1.3em); line-height: 1.3; overflow-wrap: anywhere; }
    .tile-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--pi-muted); font-size: var(--pi-text-2xs); }
  `];
}

declare global {
  interface HTMLElementTagNameMap {
    "new-session-project-sheet": NewSessionProjectSheet;
  }
}
