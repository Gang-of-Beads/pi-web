import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { Machine, Project, Workspace } from "../../api";

export type ContextSection = "machines" | "projects" | "workspaces";

/**
 * One line that says where you are, and opens the picker for each step.
 *
 * The sidebar used to stack four scrolling sections, so the machine and the
 * project - chosen once and then only read - held the same height as the
 * session list, which is the one you work in. This collapses the first three
 * into a breadcrumb of chips: the current value is legible at a glance, tapping
 * a chip opens that picker in the panel body, and choosing returns the body to
 * the sessions.
 *
 * Creating lives here too. A "+" next to the step it creates is the shortest
 * path from "I need a project" to having one, and it stops the command palette
 * from being the only way in.
 */
@customElement("app-context-switcher")
export class AppContextSwitcher extends LitElement {
  @property({ attribute: false }) machines: readonly Machine[] = [];
  @property({ attribute: false }) selectedMachine?: Machine;
  @property({ attribute: false }) selectedProject?: Project;
  @property({ attribute: false }) selectedWorkspace?: Workspace;
  /** Which picker the panel body is showing, if any. */
  @property({ attribute: false }) openSection?: ContextSection;
  @property({ attribute: false }) onOpenSection?: (section: ContextSection) => void;
  @property({ attribute: false }) onAddMachine?: () => void;
  @property({ attribute: false }) onAddProject?: () => void;

  override render() {
    const showMachines = this.machines.length > 1;
    return html`
      <nav aria-label="Current context">
        ${showMachines
          ? this.renderStep("machines", "Machine", this.selectedMachine?.name, this.onAddMachine, "Add machine")
          : nothing}
        ${this.renderStep("projects", "Project", this.selectedProject?.name, this.onAddProject, "Add project")}
        ${this.renderStep("workspaces", "Workspace", this.selectedWorkspace?.label, undefined, undefined)}
      </nav>
    `;
  }

  private renderStep(
    section: ContextSection,
    label: string,
    value: string | undefined,
    onAdd: (() => void) | undefined,
    addLabel: string | undefined,
  ) {
    const open = this.openSection === section;
    return html`
      <div class=${open ? "step open" : "step"}>
        <button
          type="button"
          class="chip"
          aria-expanded=${open ? "true" : "false"}
          aria-label=${value === undefined ? `Choose ${label.toLowerCase()}` : `${label}: ${value}. Change it`}
          title=${value ?? `Choose ${label.toLowerCase()}`}
          @click=${() => { this.onOpenSection?.(section); }}
        >
          <span class="chip-label">${label}</span>
          <span class="chip-value">${value ?? "Choose"}</span>
        </button>
        ${onAdd === undefined || addLabel === undefined
          ? nothing
          : html`<button type="button" class="add" title=${addLabel} aria-label=${addLabel} @click=${() => { onAdd(); }}>+</button>`}
      </div>
    `;
  }

  static override styles = css`
    :host { display: block; flex: 0 0 auto; border-bottom: 1px solid var(--pi-border); background: var(--pi-bg); }
    button { -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
    nav { display: flex; align-items: stretch; gap: 6px; padding: 8px 10px; overflow-x: auto; scrollbar-width: none; }
    nav::-webkit-scrollbar { display: none; }
    .step { flex: 1 1 0; min-width: 0; display: flex; align-items: stretch; gap: 4px; }
    .chip { flex: 1 1 auto; min-width: 0; display: grid; gap: 1px; justify-items: start; min-height: 44px; border: 1px solid var(--pi-border); border-radius: 10px; background: var(--pi-surface); color: var(--pi-text); padding: 5px 9px; font: inherit; text-align: left; cursor: pointer; }
    .step.open .chip { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
    .chip:hover { border-color: var(--pi-accent); }
    .chip:focus-visible, .add:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 1px; }
    .chip-label { color: var(--pi-muted); font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
    .chip-value { min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 600; }
    .add { flex: 0 0 auto; width: 32px; min-height: 44px; border: 1px solid var(--pi-border); border-radius: 10px; background: var(--pi-surface); color: var(--pi-muted); font-size: 18px; line-height: 1; cursor: pointer; }
    .add:hover { color: var(--pi-text); border-color: var(--pi-accent); }
    @media (pointer: coarse) {
      .add { width: 40px; }
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "app-context-switcher": AppContextSwitcher;
  }
}
