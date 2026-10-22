import { LitElement, css, html, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { PropertyValues } from "lit";
import { SettledRemovals } from "./settledRemovals";
import { LOCAL_MACHINE_ID } from "../../machineKeys";
import type { ApprovedMachineOrigin } from "../../../../shared/machineAccess";
import { machineAccessApi } from "../../api/machineAccess";
import { interactiveSurfaceStyles } from "../shared";
import { settingsControlStyles } from "./settingsControlStyles";
import { QUIET_WINDOW_MS, retryDelayMs } from "../../sync/readPhase";

/**
 * The other machines' pages this machine approved to use it from a browser, each with Remove
 * (docs/design/browser-direct-machines.md). Remove leaves the list at once and is held for the
 * host's Undo window (instant-actions.md). A list that could not be read says so instead of
 * looking empty: "none approved" and "unknown" lead the reader to different conclusions.
 */

type SectionKind = "reading" | "unreadable" | "empty" | "listed";

const APPROVED_AT = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

@customElement("settings-machine-access-section")
export class SettingsMachineAccessSection extends LitElement {
  @state() private approved: readonly ApprovedMachineOrigin[] | undefined;
  @state() private readError: string | undefined;
  /** The origins being forgotten; the host's instant actions own them. */
  @property({ attribute: false }) hiddenOrigins: ReadonlySet<string> = new Set();
  @property({ attribute: false }) onForget?: (entry: ApprovedMachineOrigin) => void;
  private readonly removals = new SettledRemovals();
  private readAttempt = 0;
  private readAgainTimer: ReturnType<typeof setTimeout> | undefined;

  override disconnectedCallback(): void {
    clearTimeout(this.readAgainTimer);
    super.disconnectedCallback();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.read();
  }

  /** Read the approved pages; a read that did not answer is read again by itself (B48: no Try again). */
  private async read(): Promise<void> {
    clearTimeout(this.readAgainTimer);
    try {
      this.approved = await machineAccessApi.approvedMachineOrigins();
      this.readError = undefined;
      this.readAttempt = 0;
    } catch (error) {
      this.readError = error instanceof Error ? error.message : String(error);
      this.readAgainTimer = setTimeout(() => { if (this.isConnected) void this.read(); }, retryDelayMs(this.readAttempt, QUIET_WINDOW_MS));
      this.readAttempt += 1;
    }
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("hiddenOrigins")) this.removals.update(LOCAL_MACHINE_ID, this.hiddenOrigins, () => this.read(), () => { this.requestUpdate(); });
  }

  private shown(): readonly ApprovedMachineOrigin[] {
    return (this.approved ?? []).filter((entry) => this.removals.shows(LOCAL_MACHINE_ID, entry.origin));
  }

  /** Empty only when this machine approved no page: a page whose removal is still held or settling is approved until it is read gone. */
  private kind(): SectionKind {
    if (this.readError !== undefined) return "unreadable";
    if (this.approved === undefined) return "reading";
    return this.approved.length === 0 ? "empty" : "listed";
  }

  private readonly bodies: Readonly<Record<SectionKind, () => TemplateResult>> = {
    reading: () => html`<p class="muted">Reading…</p>`,
    unreadable: () => html`<p class="muted" title=${this.readError ?? ""}>Reading the approved pages again…</p>`,
    empty: () => html`<p class="muted">No other PI WEB page can use this machine from a browser.</p>`,
    listed: () => html`<div class="list">${this.shown().map((entry) => this.renderEntry(entry))}</div>`,
  };

  override render() {
    return html`
      <section class="section-card">
        <h3>Pages Allowed to Connect Here</h3>
        <p class="muted">Other machines' PI WEB pages that may use this machine from a browser.</p>
        ${this.bodies[this.kind()]()}
      </section>
    `;
  }

  private renderEntry(entry: ApprovedMachineOrigin) {
    return html`
      <div class="entry">
        <span class="name">${entry.name}</span>
        <span class="origin">${entry.origin}</span>
        <span class="when">Approved ${APPROVED_AT.format(new Date(entry.approvedAt))}</span>
        <div class="actions"><button type="button" class="danger" @click=${() => { this.onForget?.(entry); }}>Remove</button></div>
      </div>
    `;
  }

  static override styles = [interactiveSurfaceStyles, settingsControlStyles, css`
    :host { display: block; }
    section { display: flex; flex-direction: column; gap: var(--pi-space-3); }
    .muted { margin: 0; color: var(--pi-muted); font-size: var(--pi-text-xs); line-height: 1.5; }
    .list { display: flex; flex-direction: column; gap: var(--pi-space-4); }
    .entry { box-sizing: border-box; display: flex; flex-direction: column; gap: var(--pi-space-2); padding: var(--pi-space-6); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); }
    .name { color: var(--pi-text-bright); font-weight: var(--pi-weight-semibold); }
    .origin { color: var(--pi-text-secondary); font-size: var(--pi-text-xs); overflow-wrap: anywhere; }
    .when { color: var(--pi-muted); font-size: var(--pi-text-2xs); }
    .actions { display: flex; gap: var(--pi-space-3); margin-top: var(--pi-space-2); }
    button { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-sm); background: transparent; color: var(--pi-text); padding: var(--pi-space-2) var(--pi-space-4); font-size: var(--pi-text-xs); cursor: pointer; }
    button.danger { color: var(--pi-danger); }
    button:disabled { opacity: var(--pi-disabled-opacity); cursor: default; }
  `];
}

declare global {
  interface HTMLElementTagNameMap {
    "settings-machine-access-section": SettingsMachineAccessSection;
  }
}
