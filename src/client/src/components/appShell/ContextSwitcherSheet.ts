import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { Machine, MachineHealth, Project, Workspace } from "../../api";
import type { MachineStatusSnapshot } from "../../../../shared/machineStatus";
import type { WorkspaceLabelItem } from "../../plugins/types";
import { interactiveSurfaceStyles, listStyles } from "../shared";
import "../ModalSurface";
import "../MachineList";
import "../ProjectList";
import "../WorkspaceList";

/**
 * The phone's replacement for the desktop context breadcrumb: one sheet
 * listing every machine, project and workspace, the current one marked, so
 * changing scope is one gesture from the scope chip. Picking a row hands the
 * decision to the shell's selection ladder and closes the sheet; the lists
 * themselves stay the pickers, so the sheet claims no scope of its own.
 */
@customElement("context-switcher-sheet")
export class ContextSwitcherSheet extends LitElement {
  @property({ attribute: false }) machines: Machine[] = [];
  @property({ attribute: false }) selectedMachine?: Machine;
  @property({ attribute: false }) machineStatuses: Record<string, MachineHealth> = {};
  @property({ attribute: false }) machineStatusSnapshots: Record<string, MachineStatusSnapshot> = {};
  @property({ attribute: false }) projects: Project[] = [];
  @property({ attribute: false }) projectsLoad: "unloaded" | "loading" | "loaded" | "failed" = "unloaded";
  @property({ attribute: false }) onRetryProjectsLoad?: () => void;
  @property({ attribute: false }) selectedProject?: Project;
  @property({ attribute: false }) workspaces: Workspace[] = [];
  @property({ attribute: false }) selectedWorkspace?: Workspace;
  @property({ attribute: false }) deletingWorkspaceIds: string[] = [];
  @property({ attribute: false }) workspaceLabelItems: (workspace: Workspace) => WorkspaceLabelItem[] = () => [];
  @property({ attribute: false }) onSelectMachine?: (machine: Machine) => void;
  @property({ attribute: false }) onSelectProject?: (project: Project) => void;
  @property({ attribute: false }) onSelectWorkspace?: (workspace: Workspace) => void;
  @property({ attribute: false }) onAddProject?: () => void;
  @property({ attribute: false }) onClose?: () => void;

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
            <section>
              <h2>Projects</h2>
              <project-list
                .projects=${this.projects}
                .projectsLoad=${this.projectsLoad}
                .onRetryLoad=${() => { this.onRetryProjectsLoad?.(); }}
                .selected=${this.selectedProject}
                .onAdd=${this.onAddProject === undefined ? undefined : () => { this.onAddProject?.(); }}
                .onSelect=${(project: Project) => { this.onSelectProject?.(project); }}
              ></project-list>
            </section>
            <section>
              <h2>Workspaces</h2>
              <workspace-list
                .workspaces=${this.workspaces}
                .selected=${this.selectedWorkspace}
                .machineId=${this.selectedMachine?.id ?? "local"}
                .deletingWorkspaceIds=${this.deletingWorkspaceIds}
                .workspaceLabelItems=${this.workspaceLabelItems}
                .onSelect=${(workspace: Workspace) => { this.onSelectWorkspace?.(workspace); }}
              ></workspace-list>
            </section>
          </div>
        </div>
      </modal-surface>
    `;
  }

  private renderMachineGroup() {
    if (this.machines.length < 2) return null;
    return html`
      <section>
        <h2>Machines</h2>
        <machine-list
          .machines=${this.machines}
          .selected=${this.selectedMachine}
          .statuses=${this.machineStatuses}
          .statusSnapshots=${this.machineStatusSnapshots}
          .onSelect=${(machine: Machine) => { this.onSelectMachine?.(machine); }}
        ></machine-list>
      </section>
    `;
  }

  static override styles = [interactiveSurfaceStyles, listStyles, css`
    :host { position: fixed; inset: 0; z-index: var(--pi-layer-overlay); color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui); }
    .sheet { display: flex; flex-direction: column; gap: var(--pi-space-4); width: 100%; max-height: 100%; box-sizing: border-box; padding: var(--pi-space-4); overflow-y: auto; }
    .sheet-header { display: flex; align-items: center; justify-content: space-between; gap: var(--pi-space-4); }
    .sheet-title { font-weight: 600; }
    .sheet-close { box-sizing: border-box; display: grid; place-items: center; width: 44px; height: 44px; padding: 0; border: 0; border-radius: var(--pi-radius-md); background: transparent; color: var(--pi-muted); font-size: var(--pi-text-xl); cursor: pointer; }
    .sheet-close:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: -2px; }
    .sheet-body { display: flex; flex-direction: column; gap: var(--pi-space-4); min-height: 0; }
    .sheet-body h2 { margin: 0 0 var(--pi-space-2); font-size: var(--pi-text-sm); font-weight: 600; color: var(--pi-muted); }
  `];
}

declare global {
  interface HTMLElementTagNameMap {
    "context-switcher-sheet": ContextSwitcherSheet;
  }
}
