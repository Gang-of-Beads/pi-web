import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import { renderCrossIcon, uiIconStyle } from "../uiIcons.js";
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

  private debugRefresh?: ReturnType<typeof setInterval> | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    if (new URLSearchParams(window.location.search).has("sheetdebug")) {
      this.debugRefresh = setInterval(() => { this.requestUpdate(); }, 500);
    }
  }

  override disconnectedCallback(): void {
    if (this.debugRefresh !== undefined) {
      clearInterval(this.debugRefresh);
      this.debugRefresh = undefined;
    }
    super.disconnectedCallback();
  }

  override render() {
    return html`
      <modal-surface .onClose=${() => { this.onClose?.(); }} .label=${"Projects"}>
        <div class="sheet">
          <div class="sheet-header">
            <span class="sheet-title">Projects</span>
            <button type="button" class="sheet-close" title="Close" aria-label="Close context sheet" @click=${() => { this.onClose?.(); }}>${renderCrossIcon()}</button>
          </div>
          <div class="sheet-body">
            ${this.renderMachineGroup()}
            ${this.renderNavSection("projects")}
            ${this.renderNavSection("workspaces")}
          </div>
          ${this.renderDebugChip()}
        </div>
      </modal-surface>
    `;
  }

  private renderDebugChip(): unknown {
    if (!new URLSearchParams(window.location.search).has("sheetdebug")) return nothing;
    const vv = window.visualViewport;
    const rect = this.getBoundingClientRect();
    const shellTop = getComputedStyle(this).top;
    const text = `sheet.top=${String(Math.round(rect.top))} shell.top=${shellTop} vv.top=${String(Math.round(vv?.offsetTop ?? 0))} vv.h=${String(Math.round(vv?.height ?? 0))} ivh=${String(window.innerHeight)} dvh=${String(document.documentElement.clientHeight)}`;
    return html`<div class="debug-chip">${text}</div>`;
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

  static override styles = [css`${unsafeCSS(uiIconStyle)}`, interactiveSurfaceStyles, listStyles, css`
    :host { position: fixed; top: calc(-1 * var(--pi-app-viewport-offset-top, 0px)); left: 0; right: 0; height: 100dvh; z-index: var(--pi-layer-overlay); display: block; color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui); line-height: inherit; }
    /* Full-bleed: the backdrop's centering padding left a blue frame of the
       page visible around the sheet on every edge, which read as a broken
       layer stack. The sheet IS the screen while open. */
    modal-surface { --modal-surface-place-items: stretch; --modal-surface-padding: 0px; --modal-surface-width: 100%; --modal-surface-height: 100%; --modal-surface-radius: 0px; --modal-surface-border: none; --modal-surface-shadow: none; }
    .sheet { display: flex; flex-direction: column; gap: var(--pi-space-4); width: 100%; height: 100%; box-sizing: border-box; padding: var(--pi-space-3); overflow-y: auto; background: var(--pi-bg); border: none; box-shadow: none; }
    /* The sheet is one scroll container: its title and close stay put while the
       stacked lists scroll under them, as the drawer header does. */
    .sheet-header { position: sticky; top: 0; z-index: 4; background: var(--pi-bg); margin-inline: calc(-1 * var(--pi-space-4)); padding-inline: calc(var(--pi-space-4) + var(--pi-reading-edge)); display: flex; align-items: center; justify-content: space-between; gap: var(--pi-space-4); }
    .sheet-title { font-weight: var(--pi-weight-semibold); }
    .sheet-close { box-sizing: border-box; display: grid; place-items: center; width: var(--pi-control-height-comfort); height: var(--pi-control-height-comfort); padding: 0; border: 0; border-radius: var(--pi-radius-md); background: transparent; color: var(--pi-muted); font-size: var(--pi-text-xl); line-height: 1; cursor: pointer; }
    @media (pointer: coarse) { .sheet-close { width: var(--pi-control-height-touch); height: var(--pi-control-height-touch); } }
    @media (pointer: coarse) { .sheet-close:active { background: var(--pi-surface-hover); } }
    .sheet-close:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-inset); }
    .debug-chip { position: fixed; bottom: 8px; left: 8px; max-width: calc(100% - 16px); box-sizing: border-box; padding: 4px 8px; border-radius: 6px; background: #b91c1c; color: #fff; font: 600 11px/1.4 ui-monospace, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    /* Three lists stacked with nothing above naming them: keep their headings,
       which the phone panel drops because its context row says the same word. */
    .sheet-body { --pi-list-word-heading-display: inline; --pi-list-word-heading-margin: 0 0 var(--pi-space-2); display: flex; flex-direction: column; gap: var(--pi-space-4); min-height: 0; }
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
