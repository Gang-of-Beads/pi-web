import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { NavSectionContext, MachineSectionContext, QualifiedMachineSectionContribution, QualifiedNavSectionContribution } from "../../plugins/types";
import { interactiveSurfaceStyles, listStyles } from "../shared";
import "../ModalSurface";

/**
 * The phone's replacement for the desktop context breadcrumb: one sheet
 * listing every machine, project and workspace, the current one marked, so
 * changing scope is one gesture from the scope chip. Picking a row hands the
 * decision to the shell's selection ladder and closes the sheet; the lists
 * themselves stay the pickers, so the sheet claims no scope of its own.
 */
@customElement("context-switcher-sheet")
export class ContextSwitcherSheet extends LitElement {
  /** Contributed context-navigation section bodies, slotted by reserved id. */
  @property({ attribute: false }) navSections: readonly QualifiedNavSectionContribution[] = [];
  /** The host-built snapshot and actions the contributed sections render. */
  @property({ attribute: false }) navSectionContext?: NavSectionContext;
  /** Contributed machines section bodies; the sheet's machine group renders them. */
  @property({ attribute: false }) machineSections: readonly QualifiedMachineSectionContribution[] = [];
  /** The host-built machine snapshot and actions the machine section renders. */
  @property({ attribute: false }) machineSectionContext?: MachineSectionContext;
  @property({ attribute: false }) onClose?: () => void;
  /** A machine row was picked; the host closes the sheet. */
  @property({ attribute: false }) onMachineSelected?: () => void;

  override render() {
    return html`
      <modal-surface .onClose=${() => { this.onClose?.(); }} .label=${"Change context"}>
        <div class="sheet">
          <div class="sheet-header">
            <span class="sheet-title">Change context</span>
            <button type="button" class="sheet-close" title="Close" aria-label="Close context sheet" @click=${() => { this.onClose?.(); }}>×</button>
          </div>
          <div class="sheet-body">
            ${this.renderMachineGroup()}
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

  private renderMachineGroup() {
    if (this.machineCount() < 2) return null;
    const section = this.machineSections.find((candidate) => candidate.localId === "machines");
    if (section === undefined || this.machineSectionContext === undefined) return nothing;
    const context: MachineSectionContext = {
      ...this.machineSectionContext,
      display: { hidden: false, collapsible: false, collapsed: false, tiles: false, withCreate: false },
      selectMachine: (machineId) => {
        this.machineSectionContext?.selectMachine(machineId);
        this.onMachineSelected?.();
      },
      toggleCollapsed: () => undefined,
      focusPreviousSection: () => undefined,
      focusNextSection: () => undefined,
      cancelKeyboardNavigation: () => undefined,
    };
    /* The contributed machines section renders its own heading; a second one
       here printed "Machines" twice, in two sizes, one above the other. */
    /* No wrapper: listStyles gives every <section> flex: 1 1 auto; min-height: 0,
       which collapsed this one to 16px and let the machine list paint over the
       projects below it. The contributed section brings its own frame. */
    return section.render(context);
  }

  private machineCount(): number {
    return this.machineSectionContext?.machines.length ?? 0;
  }

  static override styles = [interactiveSurfaceStyles, listStyles, css`
    :host { position: fixed; inset: 0; z-index: var(--pi-layer-overlay); color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui); }
    .sheet { display: flex; flex-direction: column; gap: var(--pi-space-4); width: 100%; max-height: 100%; box-sizing: border-box; padding: var(--pi-space-4); overflow-y: auto; }
    /* The sheet is one scroll container: its title and close stay put while the
       stacked lists scroll under them, as the drawer header does. */
    .sheet-header { position: sticky; top: 0; z-index: 1; background: var(--pi-surface); margin-inline: calc(-1 * var(--pi-space-4)); padding-inline: var(--pi-space-4); display: flex; align-items: center; justify-content: space-between; gap: var(--pi-space-4); }
    .sheet-title { font-weight: var(--pi-weight-semibold); }
    .sheet-close { box-sizing: border-box; display: grid; place-items: center; width: var(--pi-control-height-comfort); height: var(--pi-control-height-comfort); padding: 0; border: 0; border-radius: var(--pi-radius-md); background: transparent; color: var(--pi-muted); font-size: var(--pi-text-xl); line-height: 1; cursor: pointer; }
    @media (pointer: coarse) { .sheet-close { width: var(--pi-control-height-touch); height: var(--pi-control-height-touch); } }
    .sheet-close:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-inset); }
    /* Three lists stacked with nothing above naming them: keep their headings,
       which the phone panel drops because its context row says the same word. */
    .sheet-body { --pi-list-word-heading-display: inline; --pi-list-word-heading-margin: 0 0 var(--pi-space-4); display: flex; flex-direction: column; gap: var(--pi-space-4); min-height: 0; }
    /* The sheet itself scrolls. Letting each contributed list shrink turned one
       scrollable surface into three squeezed ones - a second machine rendered
       as an 8.9px sliver that read as a rendering artefact, not a row. */
    .sheet-body machine-list, .sheet-body project-list, .sheet-body workspace-list { flex: 0 0 auto; min-height: auto; }
  `];
}

declare global {
  interface HTMLElementTagNameMap {
    "context-switcher-sheet": ContextSwitcherSheet;
  }
}
