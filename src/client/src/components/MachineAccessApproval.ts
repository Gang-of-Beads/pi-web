import { LitElement, css, html, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { MachineAccessRequestView } from "../../../shared/machineAccess";
import { HttpError } from "../api/http";
import { machineAccessApi, type MachineAccessDecision } from "../api/machineAccess";
import { interactiveSurfaceStyles, pageScrollerStyles } from "./shared";
import { settingsControlStyles } from "./settings/settingsControlStyles";
import { QUIET_WINDOW_MS, retryDelayMs } from "../sync/readPhase";

/**
 * The page another machine's link opens on this machine: approve or deny a page that asks to use
 * this machine from the browser (docs/design/browser-direct-machines.md; owner, 2026-10-13: the link opens
 * the other machine's approval page, the reader approves, and it connects). Opening the link decides nothing; only a
 * tap here does, on this machine's own page. The code shown here and on the asking page is how the
 * reader tells their own request from a look-alike.
 */

type ApprovalKind = "reading" | "open" | "decided" | "gone" | "unreadable";

const COUNTDOWN_TICK_MS = 1000;

/** What the page shows for a request read at `now`: a pending request past its expiry is gone, not open. */
export function approvalKind(request: MachineAccessRequestView | undefined, readFailed: boolean, now: number): ApprovalKind {
  if (readFailed) return "unreadable";
  if (request === undefined) return "reading";
  if (request.state !== "pending") return "decided";
  return Date.parse(request.expiresAt) > now ? "open" : "gone";
}

function formattedCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

function remaining(expiresAt: string, now: number): string {
  const seconds = Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000));
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
}

@customElement("machine-access-approval")
export class MachineAccessApproval extends LitElement {
  @property({ attribute: false }) requestId = "";
  @property({ attribute: false }) onDone?: () => void;

  @state() private request: MachineAccessRequestView | undefined;
  @state() private gone = false;
  @state() private readError: string | undefined;
  @state() private deciding = false;
  @state() private decisionError: string | undefined;
  @state() private now = Date.now();
  private ticker: number | undefined;
  private readAttempt = 0;
  private readAgainTimer: ReturnType<typeof setTimeout> | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    // Surface backed up: the expiry countdown, which nothing else ticks.
    this.ticker = window.setInterval(() => { this.now = Date.now(); }, COUNTDOWN_TICK_MS);
    void this.read();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this.readAgainTimer);
    if (this.ticker !== undefined) clearInterval(this.ticker);
    this.ticker = undefined;
  }

  /** Read the request; any failed read other than a 404 is read again by itself with backoff (B48: no Try again). A 404 is the machine's answer: the request is gone. */
  private async read(): Promise<void> {
    clearTimeout(this.readAgainTimer);
    try {
      this.request = await machineAccessApi.machineAccessRequest(this.requestId);
      this.readError = undefined;
      this.readAttempt = 0;
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        this.gone = true;
        return;
      }
      this.readError = error instanceof Error ? error.message : String(error);
      this.readAgainTimer = setTimeout(() => { if (this.isConnected && !this.gone) void this.read(); }, retryDelayMs(this.readAttempt, QUIET_WINDOW_MS));
      this.readAttempt += 1;
    }
  }

  private async decide(decision: MachineAccessDecision): Promise<void> {
    this.deciding = true;
    this.decisionError = undefined;
    try {
      this.request = await machineAccessApi.decideMachineAccess(this.requestId, decision);
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) this.gone = true;
      else this.decisionError = error instanceof Error ? error.message : String(error);
    } finally {
      this.deciding = false;
    }
  }

  override render() {
    const kind = this.gone ? "gone" : approvalKind(this.request, this.readError !== undefined, this.now);
    return html`<div class="page" role="dialog" aria-modal="true" aria-labelledby="approval-title">${this.views[kind]()}</div>`;
  }

  private readonly views: Readonly<Record<ApprovalKind, () => TemplateResult>> = {
    reading: () => html`<h1 id="approval-title">Allow a page to use this machine?</h1><p class="hint">Reading the request…</p>`,
    open: () => this.renderOpen(),
    decided: () => this.renderDecided(),
    gone: () => html`
      <h1 id="approval-title">This request is gone</h1>
      <p class="warn">It expired or was already answered. Ask for access again from the other machine.</p>
      <div class="actions"><button type="button" @click=${() => this.onDone?.()}>Close</button></div>
    `,
    unreadable: () => html`
      <h1 id="approval-title">Allow a page to use this machine?</h1>
      <p class="hint" title=${this.readError ?? ""}>Reading the request again…</p>
      <div class="actions"><button type="button" @click=${() => this.onDone?.()}>Close</button></div>
    `,
  };

  private renderOpen() {
    const request = this.request;
    if (request === undefined) return html``;
    return html`
      <h1 id="approval-title">Allow a page to use this machine?</h1>
      <div class="origin">${request.origin}<small>calls itself "${request.name}"</small></div>
      <p class="warn">That page will be able to do everything you can do here: run sessions, read and change files, open terminals. Approve only if you opened it yourself.</p>
      <span class="label">Pairing code</span>
      <div class="code">${formattedCode(request.code)}</div>
      <p class="hint">Approve only if the requesting page shows the same code.</p>
      ${this.decisionError === undefined ? null : html`<p class="error" role="alert">${this.decisionError}</p>`}
      <div class="actions">
        <button type="button" class="danger" ?disabled=${this.deciding} @click=${() => { void this.decide("deny"); }}>Deny</button>
        <button type="button" class="primary" ?disabled=${this.deciding} @click=${() => { void this.decide("approve"); }}>Approve</button>
      </div>
      <p class="hint">Expires in ${remaining(request.expiresAt, this.now)}. You can remove it later in Settings → Machines.</p>
    `;
  }

  private renderDecided() {
    const request = this.request;
    if (request === undefined) return html``;
    const approved = request.state === "approved";
    return html`
      <h1 id="approval-title">${approved ? "Approved" : "Denied"}</h1>
      <div class="origin">${request.origin}<small>calls itself "${request.name}"</small></div>
      <p class="warn">${approved
        ? "That page can now use this machine. Its own tab finishes adding the machine; you can close this one. Remove it any time in Settings → Machines."
        : "That page cannot use this machine."}</p>
      <div class="actions"><button type="button" class="primary" @click=${() => this.onDone?.()}>Close</button></div>
    `;
  }

  static override styles = [interactiveSurfaceStyles, settingsControlStyles, pageScrollerStyles, css`
    :host { position: fixed; inset: 0; z-index: var(--pi-layer-blocking); overflow-y: auto; background: var(--pi-bg); color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui); }
    .page { box-sizing: border-box; display: flex; flex-direction: column; gap: var(--pi-space-5); max-width: 36rem; margin: 0 auto; padding: var(--pi-space-8) var(--pi-space-6); }
    h1 { margin: 0; color: var(--pi-text-bright); font-family: var(--pi-font-display); font-size: var(--pi-text-lg); font-weight: var(--pi-weight-semibold); }
    .origin { padding: var(--pi-space-4) var(--pi-space-5); border: 1px solid var(--pi-accent-border); border-radius: var(--pi-radius-lg); background: var(--pi-selection-bg); color: var(--pi-text-bright); overflow-wrap: anywhere; }
    .origin small { display: block; margin-top: var(--pi-space-2); color: var(--pi-text-secondary); font-size: var(--pi-text-xs); }
    .warn { margin: 0; color: var(--pi-text-secondary); font-size: var(--pi-text-sm); line-height: 1.5; }
    .label { color: var(--pi-muted); font-size: var(--pi-text-xs); }
    .code { color: var(--pi-text-bright); font: var(--pi-text-xl) var(--pi-font-mono); letter-spacing: 0.25em; text-align: center; }
    .hint { margin: 0; color: var(--pi-muted); font-size: var(--pi-text-xs); line-height: 1.5; }
    .error { margin: 0; color: var(--pi-danger); font-size: var(--pi-text-sm); }
    .actions { display: flex; gap: var(--pi-space-4); }
    .actions button { flex: 1; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); cursor: pointer; }
    .actions button.primary { border-color: var(--pi-accent); background: var(--pi-accent); color: var(--pi-on-accent, var(--pi-bg)); }
    .actions button.danger { color: var(--pi-danger); }
    .actions button:disabled { opacity: var(--pi-disabled-opacity); cursor: default; }
  `];
}

declare global {
  interface HTMLElementTagNameMap {
    "machine-access-approval": MachineAccessApproval;
  }
}
