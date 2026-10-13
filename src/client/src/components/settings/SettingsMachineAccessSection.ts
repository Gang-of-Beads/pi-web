import { LitElement, css, html, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { ApprovedMachineOrigin } from "../../../../shared/machineAccess";
import { machineAccessApi } from "../../api/machineAccess";
import { interactiveSurfaceStyles } from "../shared";
import { settingsControlStyles } from "./settingsControlStyles";

/**
 * The other machines' pages this machine approved to use it from a browser, each with Remove
 * (docs/design/browser-direct-machines.md). A list that could not be read says so instead of
 * looking empty: "none approved" and "unknown" lead the reader to different conclusions.
 */

type SectionKind = "reading" | "unreadable" | "empty" | "listed";

const APPROVED_AT = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

@customElement("settings-machine-access-section")
export class SettingsMachineAccessSection extends LitElement {
  @state() private approved: readonly ApprovedMachineOrigin[] | undefined;
  @state() private readError: string | undefined;
  @state() private removing: string | undefined;
  @state() private removeError: string | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.read();
  }

  private async read(): Promise<void> {
    this.readError = undefined;
    try {
      this.approved = await machineAccessApi.approvedMachineOrigins();
    } catch (error) {
      this.readError = error instanceof Error ? error.message : String(error);
    }
  }

  private async forget(origin: string): Promise<void> {
    this.removing = origin;
    this.removeError = undefined;
    try {
      await machineAccessApi.forgetApprovedMachineOrigin(origin);
      await this.read();
    } catch (error) {
      this.removeError = `Could not remove ${origin}: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.removing = undefined;
    }
  }

  private kind(): SectionKind {
    if (this.readError !== undefined) return "unreadable";
    if (this.approved === undefined) return "reading";
    return this.approved.length === 0 ? "empty" : "listed";
  }

  private readonly bodies: Readonly<Record<SectionKind, () => TemplateResult>> = {
    reading: () => html`<p class="muted">Reading…</p>`,
    unreadable: () => html`<p class="error">Could not read the approved pages: ${this.readError}</p><button type="button" @click=${() => { void this.read(); }}>Try again</button>`,
    empty: () => html`<p class="muted">No other PI WEB page can use this machine from a browser.</p>`,
    listed: () => html`<div class="list">${(this.approved ?? []).map((entry) => this.renderEntry(entry))}</div>`,
  };

  override render() {
    return html`
      <section>
        <h3>Pages allowed to connect here</h3>
        <p class="muted">Other machines' PI WEB pages that may use this machine from a browser.</p>
        ${this.removeError === undefined ? null : html`<p class="error" role="alert">${this.removeError}</p>`}
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
        <div class="actions"><button type="button" class="danger" ?disabled=${this.removing === entry.origin} @click=${() => { void this.forget(entry.origin); }}>Remove</button></div>
      </div>
    `;
  }

  static override styles = [interactiveSurfaceStyles, settingsControlStyles, css`
    :host { display: block; margin-top: var(--pi-space-6); }
    section { display: flex; flex-direction: column; gap: var(--pi-space-3); }
    h3 { margin: 0; color: var(--pi-text-bright); font-size: var(--pi-text-md); font-weight: var(--pi-weight-semibold); }
    .muted { margin: 0; color: var(--pi-muted); font-size: var(--pi-text-xs); line-height: 1.5; }
    .error { margin: 0; color: var(--pi-danger); font-size: var(--pi-text-xs); }
    .list { display: flex; flex-direction: column; gap: var(--pi-space-4); }
    .entry { box-sizing: border-box; display: flex; flex-direction: column; gap: var(--pi-space-2); padding: var(--pi-space-5); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); }
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
