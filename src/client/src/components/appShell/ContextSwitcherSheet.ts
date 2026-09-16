import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import { renderCrossIcon, uiIconStyle } from "../uiIcons.js";
import { customElement, property } from "lit/decorators.js";
import type { NavSectionContext, QualifiedNavSectionContribution } from "../../plugins/types";
import { interactiveSurfaceStyles, listStyles } from "../shared";
import { panelHeaderStyles } from "./panelHeaderStyles.js";
import "../ModalSurface";

/**
 * The phone's replacement for the desktop context breadcrumb: the project
 * and workspace pickers on one sheet, the current one marked, so
 * changing scope is one gesture from the scope chip. Picking a row hands the
 * decision to the shell's selection ladder and closes the sheet; the lists
 * themselves stay the pickers, so the sheet claims no scope of its own.
 */
@customElement("context-switcher-sheet")
export class ContextSwitcherSheet extends LitElement {
  /** The context this sheet edits, named beside the close: machine and project.
   *  A bare "Projects" duplicated the section heading right under it. */
  @property({ type: String }) override title = "Projects";
  /** Contributed context-navigation section bodies, slotted by reserved id. */
  @property({ attribute: false }) navSections: readonly QualifiedNavSectionContribution[] = [];
  /** The host-built snapshot and actions the contributed sections render. */
  @property({ attribute: false }) navSectionContext?: NavSectionContext;
  @property({ attribute: false }) onClose?: () => void;
  /** A machine row was picked; the host closes the sheet. */


  override render() {
    return html`
      <modal-surface .onClose=${() => { this.onClose?.(); }} .label=${"Context"}>
        <div class="sheet">
          <div class="sheet-header panel-header">
            <span class="panel-header-title">${this.title}</span>
            <button type="button" class="panel-header-action sheet-close" title="Close" aria-label="Close context sheet" @click=${() => { this.onClose?.(); }}>${renderCrossIcon()}</button>
          </div>
          <div class="sheet-body">
            ${this.renderNavSection("projects")}
            ${this.renderNavSection("workspaces")}
          </div>
        </div>
      </modal-surface>
    `;
  }


  private renderNavSection(localId: "projects" | "workspaces"): unknown {
    const section = this.navSections.find((candidate) => candidate.localId === localId);
    if (section === undefined || this.navSectionContext === undefined) return nothing;
    return section.render({ ...this.navSectionContext, display: { hidden: false, collapsible: false, collapsed: false, tiles: false, withCreate: true } });
  }



  static override styles = [css`${unsafeCSS(uiIconStyle)}`, interactiveSurfaceStyles, listStyles, panelHeaderStyles, css`
    :host { position: fixed; top: var(--pi-app-viewport-offset-top, 0px); left: 0; right: 0; height: var(--pi-app-visible-height, 100dvh); z-index: var(--pi-layer-overlay); display: block; color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui); line-height: inherit; }
    /* Full-bleed: the backdrop's centering padding left a blue frame of the
       page visible around the sheet on every edge, which read as a broken
       layer stack. The sheet IS the screen while open. */
    modal-surface { --modal-surface-place-items: stretch; --modal-surface-padding: 0px; --modal-surface-width: 100%; --modal-surface-height: 100%; --modal-surface-radius: 0px; --modal-surface-border: none; --modal-surface-shadow: none; }
    .sheet { display: flex; flex-direction: column; gap: var(--pi-space-4); width: 100%; height: 100%; box-sizing: border-box; padding: 0 0 var(--pi-space-3); overflow-y: auto; background: var(--pi-bg); border: none; box-shadow: none; }
    /* The sheet is one scroll container: its title and close stay put while the
       stacked lists scroll under them, as the drawer header does. */
    .sheet-header { position: sticky; top: 0; z-index: 4; margin-inline: 0; padding-inline: var(--pi-bar-inset); padding-top: max(0px, env(safe-area-inset-top)); }
    /* Three lists stacked with nothing above naming them: keep their headings,
       which the phone panel drops because its context row says the same word. */
    .sheet-body { --pi-list-word-heading-display: inline; --pi-list-word-heading-margin: 0 0 var(--pi-space-2); display: flex; flex-direction: column; gap: var(--pi-space-4); min-height: 0; }
    /* The sheet itself scrolls. Letting each contributed list shrink turned one
       scrollable surface into three squeezed ones - a second machine rendered
       as an 8.9px sliver that read as a rendering artefact, not a row. */
    .sheet-body project-list, .sheet-body workspace-list { flex: 0 0 auto; min-height: auto; }
  `];
}

declare global {
  interface HTMLElementTagNameMap {
    "context-switcher-sheet": ContextSwitcherSheet;
  }
}
