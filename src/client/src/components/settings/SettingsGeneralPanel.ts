import { css, html, LitElement, type PropertyValues, type TemplateResult } from "lit";
import { settingsControlStyles } from "./settingsControlStyles.js";
import { customElement, property, state } from "lit/decorators.js";
import { DEFAULT_WORKSPACE_UPLOADS_FOLDER, type PiWebConfigEnvOverrides, type PiWebConfigResponse, type PiWebConfigValues } from "../../api";
import "./SettingsPanelFrame";
import type { SettingsNotice } from "./SettingsPanelFrame";
import {
  emptyGatewayServerConfigDraft,
  emptyMachineAccessConfigDraft,
  gatewayServerConfigFromDraft,
  gatewayServerDraftFromConfig,
  machineAccessConfigPatchFromDraft,
  machineAccessDraftFromConfig,
  type GatewayServerConfigDraft,
  type MachineAccessConfigDraft,
  machineLoggingDraftFromConfig,
  machineLoggingPatchFromDraft,
  type MachineLoggingDraft,
  updateCommandPatchFromDraft,
} from "./settingsConfigDraft";
import type { SettingsReveal } from "../../settingsRoute";
import { describeError } from "../../notice";
import { interactiveSurfaceStyles } from "../shared";
import { parseQuietWindowSeconds, QUIET_WINDOW_RANGE, DEFAULT_QUIET_WINDOW_SECONDS, readQuietWindowSeconds, writeQuietWindowSeconds } from "../../quietWindow";

/** What the This browser card says under its heading after the reader acted. */
type QuietWindowNote = "none" | "saved" | "invalid" | "refused";

const QUIET_WINDOW_NOTES: Record<QuietWindowNote, TemplateResult | null> = {
  none: null,
  saved: html`<div class="message" role="status">Saved in this browser.</div>`,
  invalid: html`<div class="message error-message" role="alert">Enter a whole number of seconds from ${QUIET_WINDOW_RANGE.min} to ${QUIET_WINDOW_RANGE.max}.</div>`,
  refused: html`<div class="message error-message" role="alert">This browser would not keep the setting, so the value shown stays in use.</div>`,
};

function generalDescription(targetLabel: string): TemplateResult {
  return html`This browser's setting stays in this browser. Gateway server fields edit this local gateway. File access and upload defaults edit ${targetLabel}.`;
}

@customElement("settings-general-panel")
export class SettingsGeneralPanel extends LitElement {
  @property({ attribute: false }) configResponse: PiWebConfigResponse | undefined;
  @property({ attribute: false }) machineConfigResponse: PiWebConfigResponse | undefined;
  @property({ type: Boolean }) loading = false;
  @property({ type: Boolean }) machineLoading = false;
  @property({ type: Boolean }) saving = false;
  @property() error = "";
  @property() machineError = "";
  @property() savedMessage = "";
  @property() targetLabel = "selected machine";
  @property({ attribute: false }) onReload?: () => void | Promise<void>;
  @property({ attribute: false }) onReloadMachine?: () => void | Promise<void>;
  @property({ attribute: false }) onSave?: (config: PiWebConfigValues) => void | Promise<void>;
  @property({ attribute: false }) onSaveMachineConfig?: (config: PiWebConfigValues) => void | Promise<void>;
  /** Saves the Logs card; rejects with the reason, which the card shows itself. */
  @property({ attribute: false }) onSaveMachineLogging?: (config: PiWebConfigValues) => Promise<void>;
  /** Saves the Updates card; rejects with the reason, which the card shows itself. */
  @property({ attribute: false }) onSaveMachineUpdateCommand?: (config: PiWebConfigValues) => Promise<void>;
  /** A field another page linked to, scrolled into view and focused once the machine's config is here. */
  @property({ attribute: false }) reveal: SettingsReveal | undefined;
  @property({ attribute: false }) onRevealed?: () => void;
  @state() private updateCommandDraft = "";
  @state() private updateCommandError = "";
  @state() private gatewayDraft: GatewayServerConfigDraft = emptyGatewayServerConfigDraft();
  @state() private machineDraft: MachineAccessConfigDraft = emptyMachineAccessConfigDraft();
  @state() private loggingDraft: MachineLoggingDraft = machineLoggingDraftFromConfig({});
  @state() private loggingError = "";
  @state() private gatewayLocalError = "";
  @state() private machineLocalError = "";
  @state() private quietWindowDraft = String(readQuietWindowSeconds());
  @state() private quietWindowNote: QuietWindowNote = "none";

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("configResponse") && this.configResponse !== undefined) {
      this.gatewayDraft = gatewayServerDraftFromConfig(this.configResponse.config);
      this.gatewayLocalError = "";
    }
    if (changed.has("machineConfigResponse") && this.machineConfigResponse !== undefined) {
      this.machineDraft = machineAccessDraftFromConfig(this.machineConfigResponse.config);
      this.loggingDraft = machineLoggingDraftFromConfig(this.machineConfigResponse.effectiveConfig);
      this.machineLocalError = "";
      this.loggingError = "";
      this.updateCommandDraft = this.machineConfigResponse.config.updateCommand ?? "";
      this.updateCommandError = "";
    }
  }

  protected override updated(): void {
    if (this.reveal === undefined || this.machineConfigResponse === undefined) return;
    const field = this.renderRoot.querySelector<HTMLInputElement>(`#${this.reveal}`);
    if (field === null) return;
    field.scrollIntoView({ block: "center" });
    field.focus({ preventScroll: true });
    this.onRevealed?.();
  }

  override render(): TemplateResult {
    return html`
      <settings-panel-frame
        heading="General configuration"
        .description=${generalDescription(this.targetLabel)}
        actionLabel="Reload"
        .actionDisabled=${this.loading || this.machineLoading}
        .notices=${this.panelNotices()}
        .onAction=${() => { this.reloadAll(); }}
      >
        <div class="settings-sections">
          ${this.renderThisBrowserSettings()}
          ${this.renderGatewayServerSettings()}
          ${this.renderSelectedMachineAccessSettings()}
          ${this.renderSelectedMachineLogging()}
          ${this.renderSelectedMachineUpdates()}
        </div>
      </settings-panel-frame>
    `;
  }

  /**
   * The quiet window T (owner, 2026-09-30, B7; quietWindow.ts). Kept in this browser, not in a
   * machine's config: a phone and a desktop may want different values. A saved value applies to
   * the next session connection, which is when the page tells the daemon.
   */
  private renderThisBrowserSettings(): TemplateResult {
    return html`
      <section class="settings-card" aria-label="This browser">
        <div class="card-heading">
          <h3>This browser</h3>
          <p>Kept in this browser only, so a phone and a computer can each have their own.</p>
        </div>
        ${QUIET_WINDOW_NOTES[this.quietWindowNote]}
        <form class="config-form" @submit=${(event: Event) => { this.saveQuietWindow(event); }}>
          <label class="field">
            <span class="field-heading"><span>Check for missed updates after (seconds)</span></span>
            <input id="quiet-window" inputmode="numeric" .value=${this.quietWindowDraft} autocomplete="off" @input=${(event: Event) => { this.quietWindowDraft = inputValue(event); this.quietWindowNote = "none"; }}>
            <small>When nothing at all has arrived from a session's server for this long, PI WEB asks it for anything missed. A working connection sends a small heartbeat more often than this, so it never has to ask. From ${QUIET_WINDOW_RANGE.min} to ${QUIET_WINDOW_RANGE.max}; ${DEFAULT_QUIET_WINDOW_SECONDS} by default. Applies to each session the next time it opens or reconnects.</small>
          </label>
          <footer class="form-actions">
            <button class="primary">Save</button>
          </footer>
        </form>
      </section>
    `;
  }

  private saveQuietWindow(event: Event): void {
    event.preventDefault();
    const seconds = parseQuietWindowSeconds(this.quietWindowDraft);
    if (seconds === undefined) {
      this.quietWindowNote = "invalid";
      return;
    }
    writeQuietWindowSeconds(seconds);
    const kept = readQuietWindowSeconds();
    this.quietWindowDraft = String(kept);
    this.quietWindowNote = kept === seconds ? "saved" : "refused";
  }

  private renderGatewayServerSettings(): TemplateResult {
    const config = this.configResponse;
    return html`
      <section class="settings-card" aria-label="Gateway server settings">
        <div class="card-heading">
          <h3>Gateway server</h3>
          <p>Host, port, and allowed hosts are saved in the gateway config. Address changes require the web service to restart before the running server binds to the new address.</p>
        </div>
        ${config === undefined && this.loading ? html`<div class="loading-card">Loading gateway configuration…</div>` : html`
          <div class="config-path-card">
            <span>Gateway config file</span>
            <code>${config?.path ?? "Unknown"}</code>
            <small>${config?.exists === true ? "Existing file" : "This file will be created on save"}</small>
          </div>
          <form class="config-form" @submit=${(event: Event) => { void this.saveGatewayConfig(event); }}>
            <label class="field">
              <span class="field-heading">
                <span>Host</span>
                ${this.renderOverrideBadge("host")}
              </span>
              <input .value=${this.gatewayDraft.host} placeholder="127.0.0.1" autocomplete="off" spellcheck="false" @input=${(event: Event) => { this.updateGatewayDraft({ host: inputValue(event) }); }}>
              <small>Address the web server should bind to. Leave empty to use PI WEB's default.</small>
            </label>

            <label class="field">
              <span class="field-heading">
                <span>Port</span>
                ${this.renderOverrideBadge("port")}
              </span>
              <input .value=${this.gatewayDraft.port} inputmode="numeric" pattern="[0-9]*" placeholder="8504" autocomplete="off" @input=${(event: Event) => { this.updateGatewayDraft({ port: inputValue(event) }); }}>
              <small>TCP port from 1 to 65535. Leave empty to use PI WEB's default.</small>
            </label>

            <div class="field">
              <label class="field-heading" for="allowed-hosts-mode">
                <span>Allowed hosts</span>
                ${this.renderOverrideBadge("allowedHosts")}
              </label>
              <select id="allowed-hosts-mode" .value=${this.gatewayDraft.allowedHostsMode} @change=${(event: Event) => { this.updateGatewayDraft({ allowedHostsMode: selectValue(event) === "all" ? "all" : "list" }); }}>
                <option value="list">Only listed hosts</option>
                <option value="all">Allow every host</option>
              </select>
              <textarea aria-label="Allowed hosts, one per line" .value=${this.gatewayDraft.allowedHostsText} ?disabled=${this.gatewayDraft.allowedHostsMode === "all"} rows="4" placeholder="example.local&#10;192.168.1.20" spellcheck="false" @input=${(event: Event) => { this.updateGatewayDraft({ allowedHostsText: textAreaValue(event) }); }}></textarea>
              <small>Enter one host per line, or choose “Allow every host” to write <code>true</code>.</small>
            </div>

            ${this.renderGatewayEffectiveConfig()}

            <footer class="form-actions">
              <button class="primary" ?disabled=${this.loading || this.saving}>${this.saving ? "Saving…" : "Save gateway server config"}</button>
            </footer>
          </form>
        `}
      </section>
    `;
  }

  private renderSelectedMachineAccessSettings(): TemplateResult {
    const config = this.machineConfigResponse;
    return html`
      <section class="settings-card" aria-label="Selected machine file access and upload settings">
        <div class="card-heading">
          <h3>Selected machine file access and uploads</h3>
          <p>External filesystem roots and upload defaults are saved on ${this.targetLabel}.</p>
        </div>
        ${this.renderMachineMessages()}
        ${config === undefined ? html`<div class="loading-card">${this.machineLoading ? "Loading selected-machine file access config…" : "Selected-machine file access config is unavailable. Reload before saving file/upload settings."}</div>` : html`
          <div class="config-path-card">
            <span>Selected machine config file</span>
            <code>${config.path}</code>
            <small>${config.exists ? "Existing file" : "This file will be created on save"}</small>
          </div>
          <form class="config-form" @submit=${(event: Event) => { void this.saveMachineAccessConfig(event); }}>
            <label class="field">
              <span class="field-heading">
                <span>External filesystem roots</span>
              </span>
              <textarea .value=${this.machineDraft.allowedPathsText} rows="4" placeholder="~/SDKs&#10;/opt/reference" spellcheck="false" @input=${(event: Event) => { this.updateMachineDraft({ allowedPathsText: textAreaValue(event) }); }}></textarea>
              <small>Allowlist for absolute <code>@</code> completions and file explorer reads outside a project on ${this.targetLabel}. Enter one absolute path, Windows absolute path, or <code>~</code>-prefixed path per line. Leave empty to deny external paths by default.</small>
            </label>

            <label class="field">
              <span class="field-heading">
                <span>Default upload folder</span>
              </span>
              <input .value=${this.machineDraft.uploadDefaultFolder} placeholder=${DEFAULT_WORKSPACE_UPLOADS_FOLDER} autocomplete="off" spellcheck="false" @input=${(event: Event) => { this.updateMachineDraft({ uploadDefaultFolder: inputValue(event) }); }}>
              <small>Project-relative folder for manual file uploads on ${this.targetLabel}. Leave empty to use PI WEB's default <code>${DEFAULT_WORKSPACE_UPLOADS_FOLDER}</code>.</small>
            </label>

            ${this.renderMachineEffectiveConfig()}

            <footer class="form-actions">
              <button class="primary" ?disabled=${this.machineLoading || this.saving}>${this.saving ? "Saving…" : "Save file/upload config"}</button>
            </footer>
          </form>
        `}
      </section>
    `;
  }

/**
   * What this machine's web and session daemon logs record, and how much stays on disk (owner,
   * 2026-10-04). Saved in the machine's config; both processes pick it up within a minute.
   */
  private renderSelectedMachineLogging(): TemplateResult {
    const config = this.machineConfigResponse;
    return html`
      <section class="settings-card" aria-label="Selected machine logs">
        <div class="card-heading">
          <h3>Logs</h3>
          <p>What the PI WEB web and session daemon logs on ${this.targetLabel} record, and how much of them stays on disk. Changes apply within a minute, without a restart.</p>
        </div>
        ${this.loggingError === "" ? null : html`<div class="message error-message">${this.loggingError}</div>`}
        ${config === undefined ? html`<div class="loading-card">${this.machineLoading ? "Loading selected-machine log settings…" : "Selected-machine log settings are unavailable. Reload before saving."}</div>` : html`
          <form class="config-form" @submit=${(event: Event) => { void this.saveMachineLogging(event); }}>
            <label class="field">
              <span class="field-heading"><span>What to record</span></span>
              <select .value=${this.loggingDraft.level} @change=${(event: Event) => { this.updateLoggingDraft({ level: loggingLevelValue(event) }); }}>
                <option value="errors" ?selected=${this.loggingDraft.level === "errors"}>Failures and slow requests</option>
                <option value="requests" ?selected=${this.loggingDraft.level === "requests"}>Every request</option>
                <option value="debug" ?selected=${this.loggingDraft.level === "debug"}>Every request and debug messages</option>
              </select>
              <small>Failures are requests that answered with a server error; slow ones took a second or more. Every request writes one line each.</small>
            </label>
            <label class="field">
              <span class="field-heading"><span>Largest log file (MB)</span></span>
              <input inputmode="numeric" .value=${this.loggingDraft.maxFileMb} autocomplete="off" @input=${(event: Event) => { this.updateLoggingDraft({ maxFileMb: inputValue(event) }); }}>
              <small>A log file larger than this is moved aside as <code>web.log.1</code> or <code>sessiond.log.1</code> and started again.</small>
            </label>
            <label class="field">
              <span class="field-heading"><span>Older copies kept</span></span>
              <input inputmode="numeric" .value=${this.loggingDraft.keepFiles} autocomplete="off" @input=${(event: Event) => { this.updateLoggingDraft({ keepFiles: inputValue(event) }); }}>
              <small>How many moved-aside copies stay; the oldest beyond this is deleted.</small>
            </label>
            <footer class="form-actions">
              <button class="primary" ?disabled=${this.machineLoading || this.saving}>${this.saving ? "Saving…" : "Save log settings"}</button>
            </footer>
          </form>
        `}
      </section>
    `;
  }

  /**
   * The command the Updates page's Update button runs (owner, 2026-10-07): a nix configuration
   * cannot be updated by PI WEB on its own, so the reader saves its update here. Saved in the
   * machine's config, where it wins over the services' PI_WEB_UPDATE_COMMAND.
   */
  private renderSelectedMachineUpdates(): TemplateResult {
    const config = this.machineConfigResponse;
    return html`
      <section class="settings-card" aria-label="Selected machine updates">
        <div class="card-heading">
          <h3>Updates</h3>
          <p>What the Updates page's Update button, and the fleet Update in Settings → Machines, run on ${this.targetLabel}. From the Updates page it runs in a new terminal on the Terminal page, so you can follow it.</p>
        </div>
        ${this.updateCommandError === "" ? null : html`<div class="message error-message">${this.updateCommandError}</div>`}
        ${config === undefined ? html`<div class="loading-card">${this.machineLoading ? "Loading selected-machine update settings…" : "Selected-machine update settings are unavailable. Reload before saving."}</div>` : html`
          <form class="config-form" @submit=${(event: Event) => { void this.saveMachineUpdateCommand(event); }}>
            <label class="field">
              <span class="field-heading"><span>Update command</span></span>
              <input id="update-command" class="command-field" .value=${this.updateCommandDraft} placeholder="~/nix-config/scripts/pi-web-update.sh" autocomplete="off" autocapitalize="off" spellcheck="false" @input=${(event: Event) => { this.updateCommandDraft = inputValue(event); this.updateCommandError = ""; }}>
              <small>It should update PI WEB and restart it. Leave it empty to use the services' <code>PI_WEB_UPDATE_COMMAND</code>, or the update PI WEB works out from how it was installed (npm, a Pi package, a git checkout, a nix profile). An install from a nix configuration (home-manager, nix-darwin, NixOS) needs one here or in the services.</small>
            </label>
            <footer class="form-actions">
              <button class="primary" ?disabled=${this.machineLoading || this.saving}>${this.saving ? "Saving…" : "Save update command"}</button>
            </footer>
          </form>
        `}
      </section>
    `;
  }

  private async saveMachineUpdateCommand(event: Event): Promise<void> {
    event.preventDefault();
    this.updateCommandError = "";
    try {
      await this.onSaveMachineUpdateCommand?.(updateCommandPatchFromDraft(this.updateCommandDraft));
    } catch (error) {
      this.updateCommandError = describeError(error);
    }
  }

  private async saveMachineLogging(event: Event): Promise<void> {
    event.preventDefault();
    const result = machineLoggingPatchFromDraft(this.loggingDraft);
    if (!result.ok) {
      this.loggingError = result.error;
      return;
    }
    this.loggingError = "";
    try {
      await this.onSaveMachineLogging?.(result.patch);
    } catch (error) {
      this.loggingError = describeError(error);
    }
  }

  private updateLoggingDraft(patch: Partial<MachineLoggingDraft>): void {
    this.loggingDraft = { ...this.loggingDraft, ...patch };
    this.loggingError = "";
  }

  private panelNotices(): readonly SettingsNotice[] {
    const notices: SettingsNotice[] = [];
    const gatewayError = this.gatewayLocalError || this.error;
    if (gatewayError !== "") notices.push({ type: "error", title: "Gateway server", content: gatewayError });
    if (this.savedMessage !== "") notices.push({ type: "success", content: this.savedMessage });
    return notices;
  }

  private renderMachineMessages(): TemplateResult | null {
    const error = this.machineLocalError || this.machineError;
    if (error === "") return null;
    return html`<div class="message error-message">${error}</div>`;
  }

  private renderOverrideBadge(key: keyof PiWebConfigEnvOverrides): TemplateResult | null {
    if (this.configResponse?.envOverrides[key] !== true) return null;
    return html`<span class="override-badge">environment override</span>`;
  }

  private renderGatewayEffectiveConfig(): TemplateResult {
    const effective = this.configResponse?.effectiveConfig ?? {};
    return html`
      <section class="effective-card" aria-label="Effective gateway configuration summary">
        <h3>Effective gateway settings after environment overrides</h3>
        <dl>
          <div><dt>Host</dt><dd>${effective.host ?? html`<span class="muted">127.0.0.1 default</span>`}</dd></div>
          <div><dt>Port</dt><dd>${effective.port ?? html`<span class="muted">8504 default</span>`}</dd></div>
          <div><dt>Allowed hosts</dt><dd>${formatAllowedHosts(effective.allowedHosts)}</dd></div>
        </dl>
      </section>
    `;
  }

  private renderMachineEffectiveConfig(): TemplateResult {
    const effective = this.machineConfigResponse?.effectiveConfig ?? {};
    return html`
      <section class="effective-card" aria-label="Effective selected machine file access and upload summary">
        <h3>Effective selected-machine settings</h3>
        <dl>
          <div><dt>External roots</dt><dd>${formatAllowedPaths(effective.pathAccess?.allowedPaths)}</dd></div>
          <div><dt>Upload folder</dt><dd>${effective.uploads?.defaultFolder ?? html`<span class="muted">${DEFAULT_WORKSPACE_UPLOADS_FOLDER} default</span>`}</dd></div>
        </dl>
      </section>
    `;
  }

  private reloadAll(): void {
    void this.onReload?.();
    void this.onReloadMachine?.();
  }

  private async saveGatewayConfig(event: Event): Promise<void> {
    event.preventDefault();
    this.gatewayLocalError = "";
    try {
      await this.onSave?.(gatewayServerConfigFromDraft(this.gatewayDraft, this.configResponse?.config ?? {}));
    } catch (error) {
      this.gatewayLocalError = describeError(error);
    }
  }

  private async saveMachineAccessConfig(event: Event): Promise<void> {
    event.preventDefault();
    this.machineLocalError = "";
    try {
      await this.onSaveMachineConfig?.(machineAccessConfigPatchFromDraft(this.machineDraft));
    } catch (error) {
      this.machineLocalError = describeError(error);
    }
  }

  private updateGatewayDraft(patch: Partial<GatewayServerConfigDraft>): void {
    this.gatewayDraft = { ...this.gatewayDraft, ...patch };
    this.gatewayLocalError = "";
  }

  private updateMachineDraft(patch: Partial<MachineAccessConfigDraft>): void {
    this.machineDraft = { ...this.machineDraft, ...patch };
    this.machineLocalError = "";
  }

  static override styles = [interactiveSurfaceStyles, settingsControlStyles, css`
    :host { display: block; }
    .card-heading { display: grid; gap: var(--pi-space-3); min-width: 0; }
    h3, p { margin: 0; }
    h3 { font-size: var(--pi-text-sm); line-height: 1.3; }
    p { color: var(--pi-muted); line-height: 1.45; }
    button, input, select, textarea { font: inherit; }
    .command-field { font-family: var(--pi-font-mono); }
    button { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-4) var(--pi-space-5); cursor: pointer; }
    button:disabled { opacity: var(--pi-disabled-opacity); cursor: not-allowed; }
    .settings-sections { display: grid; gap: var(--pi-space-7); }
    .settings-card, .message, .loading-card, .config-path-card, .effective-card { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); padding: var(--pi-space-6); }
    .settings-card { display: grid; gap: var(--pi-space-7); }
    .message { margin-bottom: var(--pi-space-6); }
    .settings-card .message { margin-bottom: 0; }
    .error-message { border-color: var(--pi-danger); color: var(--pi-danger); background: color-mix(in srgb, var(--pi-danger) 10%, var(--pi-surface)); }
    .loading-card { color: var(--pi-muted); }
    .config-path-card { display: grid; gap: var(--pi-space-3); }
    .config-path-card span, .field-heading, dt { color: var(--pi-muted); font-size: var(--pi-text-xs); font-weight: var(--pi-weight-semibold); }
    .config-path-card small, .field small { font-size: var(--pi-text-2xs); color: var(--pi-muted); }
    .config-form { display: grid; gap: var(--pi-space-7); }
    .field { display: grid; gap: var(--pi-space-4); }
    .field-heading { display: flex; align-items: center; gap: var(--pi-space-4); }
    input, select, textarea { box-sizing: border-box; width: 100%; min-width: 0; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-bg); color: var(--pi-text); padding: var(--pi-space-5) var(--pi-space-5);  font: var(--pi-control-font-size, 16px) var(--pi-control-font-family, system-ui, sans-serif); line-height: inherit; }
    select { padding-block: 0; }
    input:focus, select:focus, textarea:focus { border-color: var(--pi-accent); outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-inset); }
    textarea { resize: vertical; min-height: calc(var(--pi-control-height) * 3); font-family: var(--pi-control-monospace-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); }
    textarea:disabled { opacity: var(--pi-disabled-opacity); }
    .override-badge { border: 1px solid var(--pi-warning-border); border-radius: var(--pi-radius-pill); color: var(--pi-warning); background: var(--pi-warning-surface); padding: var(--pi-space-1) var(--pi-space-4); font-size: var(--pi-text-2xs); font-weight: var(--pi-weight-semibold); text-transform: none; }
    .effective-card { display: grid; gap: var(--pi-space-5); }
    .effective-card dl { display: grid; gap: var(--pi-space-4); margin: 0; }
    .effective-card dl > div { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: var(--pi-space-6); align-items: baseline; }
    dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    .muted { color: var(--pi-muted); }
    .form-actions { display: flex; justify-content: flex-end; gap: var(--pi-space-4); padding-top: var(--pi-space-1); }
    .primary { border-color: var(--pi-accent); background: var(--pi-selection-bg); color: var(--pi-text-bright); }

    @media (max-width: 760px) {
      .effective-card dl > div { grid-template-columns: minmax(0, 1fr); gap: var(--pi-space-2); }
    }
  `];
}

function formatAllowedHosts(value: PiWebConfigValues["allowedHosts"]): string | TemplateResult {
  if (value === true) return "Any host";
  if (Array.isArray(value)) return value.length === 0 ? html`<span class="muted">None listed</span>` : value.join(", ");
  return html`<span class="muted">Unset</span>`;
}

function formatAllowedPaths(value: string[] | undefined): string | TemplateResult {
  if (value === undefined || value.length === 0) return html`<span class="muted">External paths denied</span>`;
  return value.join(", ");
}

function inputValue(event: Event): string {
  return event.target instanceof HTMLInputElement ? event.target.value : "";
}

function selectValue(event: Event): string {
  return event.target instanceof HTMLSelectElement ? event.target.value : "";
}

function textAreaValue(event: Event): string {
  return event.target instanceof HTMLTextAreaElement ? event.target.value : "";
}

const LOGGING_LEVELS: readonly MachineLoggingDraft["level"][] = ["errors", "requests", "debug"];

function loggingLevelValue(event: Event): MachineLoggingDraft["level"] {
  const value = event.target instanceof HTMLSelectElement ? event.target.value : "";
  return LOGGING_LEVELS.find((level) => level === value) ?? "errors";
}
