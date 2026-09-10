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
 * Creating lives here too, inside the chip the step already owns: a "+" zone
 * at the chip's edge is the shortest path from "I need a project" to having
 * one, without a second box stealing width from the value beside it.
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
  /** Whether a contributed machines section can actually render the step's body. */
  @property({ type: Boolean }) machineStepAvailable = true;
  @property({ attribute: false }) onAddMachine?: () => void;
  @property({ attribute: false }) onAddProject?: () => void;

  override render() {
    // Same rule as the navigation panel, contribution-aware: without the
    // machines plugin there is no machine management to reach and no picker
    // to render, so the step hides instead of leading to an empty body.
    const showMachines = this.machineStepAvailable && this.machines.length > 0;
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
    // An unset step renders the step's own word - "Machine", "Project" -
    // never "Choose machine": at a phone's three-across width that phrase
    // cut to "Choo...", a mid-word ellipsis on the one state a first-run
    // screen always shows. The step word fits at any width, the picker it
    // opens says "choose", and the aria-label keeps the verb.
    // With no value the label is redundant with the value, so the label only
    // renders once a real value sits under it.
    const unset = value === undefined;
    // The create control sits inside the chip's own border, not beside it in a
    // second box: three free-standing frames plus two plus-buttons made the row
    // read as five controls, and each button took its tap target out of the
    // value's width. One segmented frame reads as one step that can also add.
    return html`
      <div class=${open ? "step open" : "step"}>
        <div class="seg">
          <button
            type="button"
            class="chip"
            aria-expanded=${open ? "true" : "false"}
            aria-label=${value === undefined ? `Choose ${label.toLowerCase()}` : `${label}: ${value}. Change it`}
            title=${value ?? `Choose ${label.toLowerCase()}`}
            @click=${() => { this.onOpenSection?.(section); }}
          >
            ${unset
              ? nothing
              : html`<span class="chip-label">${label}</span>`}
            <span class="chip-value">${value ?? label}</span>
          </button>
          ${onAdd === undefined || addLabel === undefined
            ? nothing
            : html`<button type="button" class="add" title=${addLabel} aria-label=${addLabel} @click=${() => { onAdd(); }}>+</button>`}
        </div>
      </div>
    `;
  }

  static override styles = css`
    :host { display: block; flex: 0 0 auto; border-bottom: 1px solid var(--pi-border); background: var(--pi-bg); }
    button { font: inherit; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
    nav { display: flex; align-items: stretch; gap: var(--pi-space-3); padding: var(--pi-space-4) var(--pi-space-5); overflow-x: auto; scrollbar-width: none; }
    nav::-webkit-scrollbar { display: none; }
    .step { flex: 1 1 0; min-width: 0; container-type: inline-size; }
    /* One frame per step carries both the picker and the create control, so
       the row shows three things instead of five and every pixel of the
       border goes to the value's width instead of two extra tap targets. */
    .seg { box-sizing: border-box; display: flex; align-items: stretch; min-height: var(--pi-control-height-touch); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); color: var(--pi-text); }
    .step.open .seg { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
    @media (hover: hover) { .seg:hover { border-color: var(--pi-accent); } }
    .chip { flex: 1 1 auto; min-width: 0; display: grid; gap: var(--pi-space-1); justify-items: start; align-content: center; border: 0; background: none; padding: var(--pi-space-2) var(--pi-space-4); font: inherit; text-align: left; cursor: pointer; }
    .chip:focus-visible, .add:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-inset); }
    .chip-label { color: var(--pi-muted); font-size: var(--pi-text-2xs); text-transform: uppercase; letter-spacing: .04em; }
    .chip, .add { font: var(--pi-text-sm) var(--pi-font-ui); }
    .chip-value { min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--pi-text-sm); font-weight: var(--pi-weight-semibold); }
    /* When a step is too narrow for label and value, the label goes first:
       the value is the half that answers "where am I?". The picker it opens
       says its own name. The value steps down with it - the fallback words
       are 7-9 monospace characters and stopped fitting the three-across step
       the day the UI face went mono. */
    @container (max-width: 140px) {
      .chip-label { display: none; }
      .chip-value { font-size: var(--pi-text-2xs); }
    }
    .add { flex: 0 0 auto; align-self: stretch; width: var(--pi-control-height-comfort); border: 0; border-left: 1px solid var(--pi-border); background: none; color: var(--pi-muted); font-size: var(--pi-text-lg); line-height: 1; cursor: pointer; }
    .step.open .add { border-left-color: color-mix(in srgb, var(--pi-accent) 40%, var(--pi-border)); }
    @media (pointer: coarse) { .add { width: var(--pi-control-height-touch, 44px); } }
    @media (hover: hover) { .add:hover { color: var(--pi-text); } }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "app-context-switcher": AppContextSwitcher;
  }
}
