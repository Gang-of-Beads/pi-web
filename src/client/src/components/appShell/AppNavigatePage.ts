import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { SessionInfo } from "../../api";
import { navigateModel, type NavigateChoice, type NavigateInput, type NavigateLevel, type NavigateSessionRow } from "../../navigateModel";
import { switcherBreadcrumb } from "../../switcherBreadcrumb";
import { renderChevronRightIcon, uiIconStyle } from "../uiIcons.js";
import { interactiveSurfaceStyles } from "../shared";
import { sessionLabel } from "../../sessionLabels";

/**
 * The one navigation surface: where you are, what is under it, and what you
 * can open.
 *
 * It replaces four surfaces that each navigated away from the others - the
 * projects sheet, the quick-access menu, the panel accordion - so a reader
 * could arrive somewhere with no way back. Here the path is the only
 * navigation: tapping a higher level widens, tapping a choice narrows, and
 * neither leaves the page. Only opening a session leaves, because that is the
 * thing the page exists to reach.
 */
@customElement("app-navigate-page")
export class AppNavigatePage extends LitElement {
  @property({ attribute: false }) input?: Omit<NavigateInput, "query">;
  @property({ attribute: false }) onChoose?: (level: NavigateLevel, id: string) => void;
  @property({ attribute: false }) onWiden?: (level: NavigateLevel) => void;
  @property({ attribute: false }) onOpenSession?: (session: SessionInfo, machineId: string) => void;
  @property({ attribute: false }) onCreateSession?: () => void;
  @property({ attribute: false }) onAddProject?: () => void;
  @property({ attribute: false }) onClose?: () => void;
  /** Whether a session is open behind this page, which is what a close returns to. */
  @property({ type: Boolean }) closable = false;
  @state() private query = "";

  override render() {
    const input = this.input;
    if (input === undefined) return html`<p class="empty" role="status">Reading this machine…</p>`;
    const model = navigateModel({ ...input, query: this.query });
    const segments = switcherBreadcrumb({
      machines: input.machines,
      machineId: input.scope.machineId,
      projects: input.projects,
      projectId: input.scope.projectId,
      folders: input.folders,
      folderPath: input.scope.folderPath,
    });
    return html`
      <section class="navigate">
        <header class="path-bar">
          <div class="path-row">
          ${segments.map((segment, index) => html`
            ${index === 0 ? nothing : html`<span class="path-sep">${renderChevronRightIcon()}</span>`}
            <button type="button" class=${segment.chosen ? "path-step chosen" : "path-step"} @click=${() => { this.onWiden?.(segment.level); }}>${segment.label}</button>
          `)}
          </div>
          ${this.closable ? html`<button type="button" class="close" aria-label="Close navigation" @click=${() => { this.onClose?.(); }}>${renderChevronRightIcon()}</button>` : nothing}
        </header>
        <div class="search-row">
          <input
            class="search"
            type="search"
            inputmode="search"
            autocomplete="off"
            spellcheck="false"
            enterkeyhint="search"
            aria-label="Search sessions and tags"
            placeholder="Search sessions, #tags"
            .value=${this.query}
            @input=${(event: Event) => { if (event.target instanceof HTMLInputElement) this.query = event.target.value; }}
          />
        </div>
        <div class="actions">
          <button type="button" class="create" @click=${() => { this.onCreateSession?.(); }}>+ New session</button>
          ${this.onAddProject === undefined ? nothing : html`<button type="button" class="create secondary" @click=${() => { this.onAddProject?.(); }}>+ Add project</button>`}
        </div>
        <div class="body">
          ${model.sections.map((section) => html`
            <h3 class="section-title">${section.title}</h3>
            ${section.choices.map((choice) => this.renderChoice(choice))}
            ${section.rows.map((row) => this.renderSession(row))}
          `)}
          ${model.matchCount === 0 && this.query.trim() !== "" ? html`<p class="empty" role="status">No sessions match “${this.query.trim()}”.</p>` : nothing}
        </div>
      </section>
    `;
  }

  private renderChoice(choice: NavigateChoice) {
    return html`
      <button type="button" class=${choice.current ? "row current" : "row"} @click=${() => { this.onChoose?.(choice.level, choice.id); }}>
        <span class="row-title">${choice.label}</span>
        ${choice.detail === undefined ? nothing : html`<span class="row-detail">${choice.detail}</span>`}
      </button>
    `;
  }

  private renderSession(row: NavigateSessionRow) {
    return html`
      <button type="button" class="row session" @click=${() => { this.onOpenSession?.(row.session, row.machineId); }}>
        <span class="row-title">${row.pinned ? html`<span class="pin" aria-label="Pinned">•</span>` : nothing}${sessionLabel(row.session)}</span>
        <span class="row-detail">${row.tags.slice(0, 3).map((tag) => html`<span class="tag">#${tag}</span>`)}</span>
      </button>
    `;
  }

  static override styles = [css`${unsafeCSS(uiIconStyle)}`, interactiveSurfaceStyles, css`
    :host { display: block; min-height: 0; height: 100%; color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui); }
    .navigate { display: flex; flex-direction: column; min-height: 0; height: 100%; }
    .path-bar { flex: 0 0 auto; display: flex; align-items: center; gap: var(--pi-space-2); min-height: var(--pi-panel-header-height); padding: 0 var(--pi-bar-inset); border-bottom: 1px solid var(--pi-border); }
    .path-row { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: var(--pi-space-2); overflow-x: auto; scrollbar-width: none; white-space: nowrap; }
    .path-row::-webkit-scrollbar { display: none; }
    .path-step { box-sizing: border-box; flex: 0 0 auto; min-height: var(--pi-control-height); padding: 0 var(--pi-space-4); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text-secondary); font: inherit; cursor: pointer; }
    .path-step.chosen { border-color: var(--pi-accent-border); background: var(--pi-selection-bg); color: var(--pi-text-bright); }
    .path-sep { flex: 0 0 auto; display: inline-grid; place-items: center; color: var(--pi-muted); }
    .path-sep .ui-icon, .close .ui-icon { width: 14px; height: 14px; }
    .close { box-sizing: border-box; flex: 0 0 auto; display: inline-grid; place-items: center; width: var(--pi-panel-header-control-height); height: var(--pi-panel-header-control-height); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); cursor: pointer; }
    .search-row { flex: 0 0 auto; padding: var(--pi-space-3) var(--pi-bar-inset) 0; }
    .search { box-sizing: border-box; width: 100%; min-height: var(--pi-control-height-comfort); padding: 0 var(--pi-space-4); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); font: var(--pi-control-font-size, 16px)/1.4 var(--pi-font-ui); }
    .actions { flex: 0 0 auto; display: flex; gap: var(--pi-space-3); padding: var(--pi-space-3) var(--pi-bar-inset) 0; }
    .create { box-sizing: border-box; flex: 1 1 0; min-height: var(--pi-control-height-comfort); border: 1px solid var(--pi-accent-border); border-radius: var(--pi-radius-md); background: var(--pi-selection-bg); color: var(--pi-text-bright); font: inherit; cursor: pointer; }
    .create.secondary { border-color: var(--pi-border); background: var(--pi-surface); color: var(--pi-text); }
    .body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: var(--pi-space-3) var(--pi-bar-inset) var(--pi-space-5); display: flex; flex-direction: column; gap: var(--pi-space-2); }
    .section-title { margin: var(--pi-space-4) 0 var(--pi-space-1); color: var(--pi-muted); font: var(--pi-text-2xs) var(--pi-font-ui); font-weight: var(--pi-weight-strong); letter-spacing: .08em; text-transform: uppercase; }
    .row { box-sizing: border-box; display: grid; gap: 2px; width: 100%; min-height: var(--pi-control-height-touch); padding: var(--pi-space-2) var(--pi-space-4); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); font: inherit; text-align: start; cursor: pointer; }
    .row.current { border-color: var(--pi-accent-border); background: var(--pi-selection-bg); }
    .row-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row-detail { min-width: 0; display: flex; gap: var(--pi-space-3); overflow: hidden; color: var(--pi-muted); font-size: var(--pi-text-2xs); white-space: nowrap; }
    .pin { margin-right: var(--pi-space-2); color: var(--pi-accent); }
    .empty { margin: var(--pi-space-5) 0; color: var(--pi-muted); font-size: var(--pi-text-xs); }
  `];
}

declare global {
  interface HTMLElementTagNameMap {
    "app-navigate-page": AppNavigatePage;
  }
}
