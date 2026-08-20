import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { Machine, MachineHealth } from "../../api";
import type { PiWebFleetReport, PiWebFleetRunResponse } from "../../../../shared/apiTypes";
import "./SettingsFleetSection";

/**
 * Dedicated machines management panel: every connected machine (including
 * Local) as a responsive card grid with rename and remove actions, plus an
 * Add machine entry point. Renaming the local machine persists as an alias;
 * health dots mirror the machine switcher.
 */

@customElement("settings-machines-panel")
export class SettingsMachinesPanel extends LitElement {
  @property({ attribute: false }) machines: Machine[] = [];
  @property({ attribute: false }) machineStatuses: Record<string, MachineHealth> = {};
  @property({ attribute: false }) onAdd?: () => void;
  @property({ attribute: false }) onRename?: (machine: Machine, name: string) => void | Promise<void>;
  @property({ attribute: false }) onRemove?: (machine: Machine) => void | Promise<void>;
  @property({ attribute: false }) fleetReport?: PiWebFleetReport;
  @property({ type: Boolean }) fleetLoading = false;
  @property({ attribute: false }) fleetError?: string;
  @property({ attribute: false }) onRefreshFleet?: () => void | Promise<void>;
  @property({ attribute: false }) onRunFleet?: (operation: "restart" | "update", machineIds?: readonly string[]) => Promise<PiWebFleetRunResponse | undefined>;

  private renamingId: string | undefined;
  private draftName = "";

  override render() {
    return html`
      <settings-panel-frame>
        <div class="machines-heading">
          <div>
            <h2>Machines</h2>
            <p class="muted">Renaming the local machine applies a display alias; other fields stay fixed.</p>
          </div>
          <button type="button" class="add-button" @click=${() => this.onAdd?.()}>Add machine</button>
        </div>
        <div class="machine-grid">
          ${this.machines.map((machine) => this.renderMachineCard(machine))}
          ${this.machines.length === 0 ? html`<p class="empty">No machines configured.</p>` : null}
        </div>
        <settings-fleet-section
          .report=${this.fleetReport}
          ?loading=${this.fleetLoading}
          .error=${this.fleetError}
          .onRefresh=${() => this.onRefreshFleet?.()}
          .onRun=${(operation: "restart" | "update", machineIds?: readonly string[]) => this.onRunFleet?.(operation, machineIds) ?? Promise.resolve(undefined)}
        ></settings-fleet-section>
      </settings-panel-frame>
    `;
  }

  private renderMachineCard(machine: Machine) {
    const health = this.machineStatuses[machine.id];
    const statusClass = health?.status === "online" ? "online" : health?.status === "offline" ? "offline" : "unknown";
    const renaming = this.renamingId === machine.id;
    return html`
      <div class="machine-card" data-machine-id=${machine.id}>
        <div class="machine-card-header">
          <span class="status-dot ${statusClass}" aria-hidden="true"></span>
          <span class="machine-kind">${machine.kind === "local" ? "Local" : "Remote"}</span>
        </div>
        ${renaming ? html`
          <form class="rename-form" @submit=${(event: Event) => { event.preventDefault(); void this.confirmRename(machine); }}>
            <input .value=${this.draftName} aria-label="Machine name" @input=${(event: Event) => { const input = event.target; if (input instanceof HTMLInputElement) this.draftName = input.value; }} />
            <div class="rename-actions">
              <button type="submit" ?disabled=${this.draftName.trim() === ""}>Save</button>
              <button type="button" @click=${() => { this.renamingId = undefined; }}>Cancel</button>
            </div>
          </form>
        ` : html`
          <div class="machine-card-name" title=${machine.id}>${machine.name}</div>
          <div class="machine-card-sub">${machine.kind === "local" ? "This device" : machine.baseUrl ?? machine.id}</div>
          <div class="machine-card-actions">
            <button type="button" @click=${() => { this.startRename(machine); }}>Rename</button>
            ${machine.kind === "remote" ? html`
              <button type="button" class="danger" @click=${() => void this.onRemove?.(machine)}>Remove</button>
            ` : null}
          </div>
        `}
      </div>
    `;
  }

  private startRename(machine: Machine): void {
    this.renamingId = machine.id;
    this.draftName = machine.name;
  }

  private async confirmRename(machine: Machine): Promise<void> {
    const name = this.draftName.trim();
    this.renamingId = undefined;
    if (name === "" || name === machine.name) return;
    await this.onRename?.(machine, name);
  }

  static override styles = css`
    :host { display: block; color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui); }
    .machines-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--pi-space-6); margin-bottom: var(--pi-space-6); }
    h2 { margin: 0 0 var(--pi-space-2); font-family: var(--pi-font-display); font-size: var(--pi-text-lg); font-weight: var(--pi-weight-semibold); letter-spacing: -0.01em; }
    .muted { margin: 0; color: var(--pi-muted); font-size: var(--pi-text-xs); line-height: 1.4; }
    .add-button { flex: 0 0 auto; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-4) var(--pi-space-5); cursor: pointer; }
    .machine-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--pi-space-4); }
    .machine-card { box-sizing: border-box; display: flex; flex-direction: column; gap: var(--pi-space-3); min-height: 96px; padding: var(--pi-space-5); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); }
    .machine-card-header { display: flex; align-items: center; gap: var(--pi-space-3); }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--pi-dim); }
    .status-dot.online { background: var(--pi-success); }
    .status-dot.offline { background: var(--pi-danger); }
    .machine-kind { color: var(--pi-muted); font-size: var(--pi-text-2xs); text-transform: uppercase; letter-spacing: .04em; }
    .machine-card-name { font-weight: 600; overflow-wrap: anywhere; }
    .machine-card-sub { color: var(--pi-muted); font-size: var(--pi-text-2xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .machine-card-actions { display: flex; gap: var(--pi-space-3); margin-top: auto; }
    .machine-card-actions button { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-sm); background: transparent; color: var(--pi-text); padding: var(--pi-space-2) var(--pi-space-4); font-size: var(--pi-text-xs); cursor: pointer; }
    .machine-card-actions button.danger { color: var(--pi-danger); }
    .rename-form { display: grid; gap: var(--pi-space-3); }
    .rename-form input { box-sizing: border-box; width: 100%; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-sm); background: var(--pi-bg); color: var(--pi-text); padding: var(--pi-space-3) var(--pi-space-4); }
    .rename-actions { display: flex; gap: var(--pi-space-3); }
    .rename-actions button { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-sm); background: transparent; color: var(--pi-text); padding: var(--pi-space-2) var(--pi-space-4); font-size: var(--pi-text-xs); cursor: pointer; }
    .empty { color: var(--pi-muted); }
    @media (max-width: 760px) {
      .machine-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: var(--pi-space-3); }
      .machine-card { min-height: 88px; padding: var(--pi-space-4); }
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "settings-machines-panel": SettingsMachinesPanel;
  }
}