import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { Machine, MachineHealth } from "../../api";

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
    :host { display: block; color: var(--pi-text); font: 14px system-ui, sans-serif; }
    .machines-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
    h2 { margin: 0 0 4px; font-size: 15px; }
    .muted { margin: 0; color: var(--pi-muted); font-size: 12px; line-height: 1.4; }
    .add-button { flex: 0 0 auto; border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 7px 10px; cursor: pointer; }
    .machine-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
    .machine-card { box-sizing: border-box; display: flex; flex-direction: column; gap: 6px; min-height: 96px; padding: 10px; border: 1px solid var(--pi-border); border-radius: 10px; background: var(--pi-surface); }
    .machine-card-header { display: flex; align-items: center; gap: 6px; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--pi-dim); }
    .status-dot.online { background: var(--pi-success); }
    .status-dot.offline { background: var(--pi-danger); }
    .machine-kind { color: var(--pi-muted); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
    .machine-card-name { font-weight: 600; overflow-wrap: anywhere; }
    .machine-card-sub { color: var(--pi-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .machine-card-actions { display: flex; gap: 6px; margin-top: auto; }
    .machine-card-actions button { border: 1px solid var(--pi-border); border-radius: 6px; background: transparent; color: var(--pi-text); padding: 4px 8px; font-size: 12px; cursor: pointer; }
    .machine-card-actions button.danger { color: var(--pi-danger); }
    .rename-form { display: grid; gap: 6px; }
    .rename-form input { box-sizing: border-box; width: 100%; border: 1px solid var(--pi-border); border-radius: 6px; background: var(--pi-bg); color: var(--pi-text); padding: 6px 8px; }
    .rename-actions { display: flex; gap: 6px; }
    .rename-actions button { border: 1px solid var(--pi-border); border-radius: 6px; background: transparent; color: var(--pi-text); padding: 4px 8px; font-size: 12px; cursor: pointer; }
    .empty { color: var(--pi-muted); }
    @media (max-width: 760px) {
      .machine-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 6px; }
      .machine-card { min-height: 88px; padding: 8px; }
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "settings-machines-panel": SettingsMachinesPanel;
  }
}