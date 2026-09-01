import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { PiWebFleetReport, PiWebFleetRunResponse } from "../../../../shared/apiTypes";
import { interactiveSurfaceStyles } from "../shared";

/**
 * The machines this server can act on, and the two actions worth taking on all
 * of them at once.
 *
 * Updating or restarting "everything" used to be a slash command whose scope
 * depended on which session happened to be selected, so nobody could say
 * afterwards which machines had been covered. Here the answer is on screen
 * before the action: the server that will do the fan-out is named, each machine
 * shows whether it is reachable and what version it is running, and the result
 * is reported per machine rather than as a single success or failure.
 */
@customElement("settings-fleet-section")
export class SettingsFleetSection extends LitElement {
  @property({ attribute: false }) report?: PiWebFleetReport;
  @property({ type: Boolean }) loading = false;
  @property({ attribute: false }) error?: string;
  @property({ attribute: false }) onRefresh?: () => void | Promise<void>;
  @property({ attribute: false }) onRun?: (operation: "restart" | "update", machineIds?: readonly string[]) => Promise<PiWebFleetRunResponse | undefined>;

  @state() private running: string | undefined;
  @state() private lastRun: PiWebFleetRunResponse | undefined;

  override render() {
    const machines = this.report?.machines ?? [];
    return html`
      <section class="fleet">
        <header>
          <div>
            <h3>Machines and updates</h3>
            <p class="muted">
              ${this.report === undefined
                ? "Reading the machine list…"
                : html`Fan-out runs from <strong>${this.report.hub.name}</strong> and covers the ${String(machines.length)} machine${machines.length === 1 ? "" : "s"} it knows.`}
            </p>
          </div>
          <button type="button" class="ghost" ?disabled=${this.loading} @click=${() => void this.onRefresh?.()}>
            ${this.loading ? "Checking…" : "Check again"}
          </button>
        </header>

        ${this.error === undefined ? nothing : html`<p class="error" role="alert">${this.error}</p>`}

        <ul class="machines">
          ${machines.map((machine) => html`
            <li class=${machine.online ? "machine" : "machine offline"}>
              <span class="dot" aria-hidden="true"></span>
              <span class="name">${machine.name}</span>
              <span class="detail">
                ${machine.online ? machine.version ?? "version unknown" : machine.error ?? "unreachable"}
                ${machine.piVersion === undefined ? nothing : html` · pi ${machine.piVersion}`}
              </span>
              <span class="row-actions">
                <button type="button" ?disabled=${this.running !== undefined || !machine.online} @click=${() => void this.run("update", [machine.machineId])}>Update</button>
                <button type="button" ?disabled=${this.running !== undefined || !machine.online} @click=${() => void this.run("restart", [machine.machineId])}>Restart</button>
              </span>
            </li>
          `)}
          ${machines.length === 0 && !this.loading ? html`<li class="empty">No machines to report.</li>` : nothing}
        </ul>

        <div class="all-actions">
          <button type="button" ?disabled=${this.running !== undefined || machines.length === 0} @click=${() => void this.run("update")}>
            ${this.running === "update" ? "Updating…" : "Update every machine"}
          </button>
          <button type="button" ?disabled=${this.running !== undefined || machines.length === 0} @click=${() => void this.run("restart")}>
            ${this.running === "restart" ? "Restarting…" : "Restart every machine"}
          </button>
        </div>

        ${this.renderOutcome()}
      </section>
    `;
  }

  private renderOutcome() {
    if (this.lastRun === undefined) return nothing;
    const failed = this.lastRun.outcomes.filter((outcome) => !outcome.started);
    return html`
      <div class=${failed.length === 0 ? "outcome" : "outcome has-failures"} role="status">
        <strong>${this.lastRun.operation === "update" ? "Update" : "Restart"} from ${this.lastRun.hub.name}</strong>
        <ul>
          ${this.lastRun.outcomes.map((outcome) => html`
            <li>${outcome.started ? "Started" : "Did not start"} · ${outcome.name}${outcome.error === undefined ? nothing : html` — ${outcome.error}`}</li>
          `)}
        </ul>
      </div>
    `;
  }

  private async run(operation: "restart" | "update", machineIds?: readonly string[]): Promise<void> {
    if (this.onRun === undefined) return;
    this.running = operation;
    try {
      this.lastRun = await this.onRun(operation, machineIds);
    } finally {
      this.running = undefined;
    }
  }

  static override styles = [interactiveSurfaceStyles, css`
    :host { display: block; color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui); }
    .fleet { display: grid; gap: var(--pi-space-5); }
    header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--pi-space-6); }
    h3 { margin: 0 0 var(--pi-space-2); font-size: var(--pi-text-base); }
    .muted { margin: 0; color: var(--pi-muted); font-size: var(--pi-text-xs); line-height: 1.4; }
    .error { margin: 0; color: var(--pi-danger); font-size: var(--pi-text-xs); }
    button { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-3) var(--pi-space-5); font: inherit; font-size: var(--pi-text-xs); cursor: pointer; }
    button:disabled { opacity: .5; cursor: not-allowed; }
    button:focus-visible:not(:disabled) { border-color: var(--pi-accent); }
    @media (hover: hover) { button:hover:not(:disabled) { border-color: var(--pi-accent); } }
    .ghost { flex: 0 0 auto; }
    .machines { display: grid; gap: var(--pi-space-3); margin: 0; padding: 0; list-style: none; }
    .machine { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: var(--pi-space-4); padding: var(--pi-space-4) var(--pi-space-5); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); }
    .machine .detail { grid-column: 2; color: var(--pi-muted); font-size: var(--pi-text-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .machine .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .machine .row-actions { grid-row: 1 / span 2; grid-column: 3; display: flex; gap: var(--pi-space-3); }
    .dot { grid-row: 1 / span 2; width: 8px; height: 8px; border-radius: 50%; background: var(--pi-success); }
    .machine.offline .dot { background: var(--pi-danger); }
    .machine.offline .name { color: var(--pi-muted); }
    .empty { color: var(--pi-muted); font-size: var(--pi-text-xs); }
    .all-actions { display: flex; flex-wrap: wrap; gap: var(--pi-space-4); }
    .outcome { display: grid; gap: var(--pi-space-2); padding: var(--pi-space-4) var(--pi-space-5); border: 1px solid var(--pi-success-border); border-radius: var(--pi-radius-lg); background: var(--pi-success-surface); font-size: var(--pi-text-xs); }
    .outcome.has-failures { border-color: var(--pi-warning-border); background: var(--pi-warning-surface); }
    .outcome ul { margin: 0; padding-left: var(--pi-space-7); }
    @media (max-width: 760px) {
      .machine { grid-template-columns: auto minmax(0, 1fr); }
      .machine .row-actions { grid-row: auto; grid-column: 1 / -1; }
    }
  `];
}

declare global {
  interface HTMLElementTagNameMap {
    "settings-fleet-section": SettingsFleetSection;
  }
}
