import { LitElement, css, html } from "lit";
import { property, query, state } from "lit/decorators.js";
import type { MachineCreateInput } from "@gang-of-beads/pi-web/plugin-api";
import { renderHostCloseIcon, adoptMachinesHostStyles } from "./hostUi";
import { keyBelongsToInputMethod } from "./inputMethodKey";
import { approvalUrl, PairingError, readPairing, requestAccess, type PairingRequest, type PairingState } from "./pairing";

type ConnectFrom = "browser" | "server";

/**
 * Where a pairing stands at each poll, decided by `pairingStep` and carried out by the dialog's
 * table: still waiting, approved (the machine is added), denied (the machine's answer, final), or
 * gone - the machine no longer knows it, because it expired there or the machine restarted - which
 * asks again by itself with a new code, so the reader never presses Try again (owner, 2026-10-13).
 * Expiry is the machine's to say: decided on this device's clock, a clock ahead of the machine's
 * made every new request look expired at once, and the dialog asked again every second.
 */
type PairingStep = "waiting" | "approved" | "denied" | "gone";

const STEP_BY_STATE: Readonly<Record<PairingState, PairingStep>> = { pending: "waiting", approved: "approved", denied: "denied" };

function pairingStep(current: PairingRequest | undefined): PairingStep {
  return current === undefined ? "gone" : STEP_BY_STATE[current.state];
}

const CONNECT_FROM_HINT: Readonly<Record<ConnectFrom, (name: string) => string>> = {
  browser: (name) => `This device talks to ${name} directly; ${name} asks you to approve this page once.`,
  server: (name) => `This PI WEB talks to ${name} for every device that opens it.`,
};

const POLL_EVERY_TICKS = 2;
const TICK_MS = 1000;

/**
 * The add-machine form, rendered inside the shell's dialog surface. A submit
 * resolves to the reason it did not go through, or undefined when it did; the
 * opener owns closing the dialog, the way the add-project dialog does.
 *
 * A machine reached from this browser is paired first (pairing.ts): the dialog
 * asks the machine for access, shows the code and a link to the machine's own
 * approval page, and adds the machine once the reader approved it there
 * (docs/design/browser-direct-machines.md, mockups approved 2026-10-13).
 */
export class MachineDialog extends LitElement {
  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();
    if (root instanceof ShadowRoot) adoptMachinesHostStyles(root);
    return root;
  }

  @property({ attribute: false }) onSubmit?: (input: MachineCreateInput) => Promise<string | undefined>;
  @property({ attribute: false }) onCancel?: () => void;

  @state() private url = "";
  @state() private name = "";
  @state() private token = "";
  @state() private connectFrom: ConnectFrom = "browser";
  @state() private submitting = false;
  /** The request for access while it waits on the machine; the dialog shows its code. */
  @state() private pairing: PairingRequest | undefined = undefined;
  /** The machine denied this page: final, until the reader goes back to the form. */
  @state() private pairingDenied = false;
  @state() private now = Date.now();
  private ticker: number | undefined;
  private ticks = 0;
  /** Aborted when the dialog closes, so an ask or a poll still waiting on the machine is dropped with it. */
  private reaching = new AbortController();
  /** Why the last submit did not go through, shown where the submit happened. */
  @state() private submitError: string | undefined = undefined;
  @query("input[name='name']") private nameInput?: HTMLInputElement;

  private nameEdited = false;
  private previousSuggestedName = "";

  private handleUrlInput(event: InputEvent): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    const url = event.target.value;
    const suggestedName = suggestedMachineNameFromUrl(url);
    if (!this.nameEdited || this.name.trim() === "" || this.name === this.previousSuggestedName) this.name = suggestedName;
    this.previousSuggestedName = suggestedName;
    this.url = url;
  }

  private handleNameInput(event: InputEvent): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    this.nameEdited = true;
    this.name = event.target.value;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stopWaiting();
    this.reaching.abort();
    this.reaching = new AbortController();
  }

  private chooseConnection(connectFrom: ConnectFrom): void {
    this.connectFrom = connectFrom;
    this.submitError = undefined;
  }

  private handleTokenInput(event: InputEvent): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    this.token = event.target.value;
  }

  // Escape and backdrop presses are owned by the dialog surface (routed to
  // `onCancel`); this handler keeps the form's Enter-to-advance behavior.
  private handleKeyDown(event: KeyboardEvent): void {
    if (keyBelongsToInputMethod(event)) return;
    if (event.key === "Enter" && event.target instanceof HTMLInputElement && event.target.name === "baseUrl" && machineBaseUrlValidationMessage(this.url) === undefined) {
      event.preventDefault();
      void this.updateComplete.then(() => {
        this.nameInput?.focus();
        this.nameInput?.select();
      });
    }
  }

  private handleSubmit(event: SubmitEvent): void {
    event.preventDefault();
    void this.submit();
  }

  private async submit(): Promise<void> {
    const input = this.validInput();
    if (input === undefined || this.submitting) return;
    if (this.connectFrom === "browser") {
      await this.askForAccess(input.baseUrl, input.name);
      return;
    }
    await this.add(input);
  }

  private async add(input: MachineCreateInput): Promise<void> {
    this.submitting = true;
    try {
      const failure = await this.onSubmit?.(input);
      if (failure === undefined) return;
      this.submitError = failure;
    } finally {
      if (this.isConnected) this.submitting = false;
    }
  }

  private async askForAccess(baseUrl: string, name: string): Promise<void> {
    this.submitting = true;
    this.submitError = undefined;
    this.pairingDenied = false;
    try {
      const answer = await requestAccess(baseUrl, location.host, this.reaching.signal);
      if (!this.isConnected) return;
      if (answer.kind === "approved") {
        await this.add({ name, baseUrl, connectFrom: "browser" });
        return;
      }
      this.pairing = answer.request;
      this.startWaiting(baseUrl, name);
    } catch (error) {
      if (this.isConnected) this.submitError = error instanceof PairingError ? error.message : String(error);
    } finally {
      if (this.isConnected) this.submitting = false;
    }
  }

  /** The machine never pushes pairing state to this page, so the dialog ticks the countdown locally and polls the request's state. */
  private startWaiting(baseUrl: string, name: string): void {
    this.stopWaiting();
    this.ticks = 0;
    this.now = Date.now();
    this.ticker = window.setInterval(() => { void this.tick(baseUrl, name); }, TICK_MS);
  }

  private stopWaiting(): void {
    if (this.ticker !== undefined) window.clearInterval(this.ticker);
    this.ticker = undefined;
  }

  private async tick(baseUrl: string, name: string): Promise<void> {
    this.now = Date.now();
    const pairing = this.pairing;
    if (pairing === undefined) return;
    this.ticks += 1;
    const polls = this.ticks % POLL_EVERY_TICKS === 0;
    const current = polls ? await readPairing(baseUrl, pairing.id, this.reaching.signal).catch(() => pairing) : pairing;
    if (this.pairing?.id !== pairing.id) return;
    this.pairingSteps[pairingStep(current)]({ baseUrl, name, current });
  }

  private readonly pairingSteps: Readonly<Record<PairingStep, (at: { baseUrl: string; name: string; current: PairingRequest | undefined }) => void>> = {
    waiting: ({ current }) => { this.pairing = current; },
    approved: ({ baseUrl, name, current }) => {
      this.pairing = current;
      this.stopWaiting();
      void this.add({ name, baseUrl, connectFrom: "browser" });
    },
    denied: () => {
      this.stopWaiting();
      this.pairing = undefined;
      this.pairingDenied = true;
    },
    gone: ({ baseUrl, name }) => { this.askAgain(baseUrl, name); },
  };

  /** A request that ran out is asked again by itself: the old code stays on screen until the new one replaces it. */
  private askAgain(baseUrl: string, name: string): void {
    this.stopWaiting();
    void this.askForAccess(baseUrl, name);
  }

  private backToForm(): void {
    this.stopWaiting();
    this.pairing = undefined;
    this.pairingDenied = false;
  }

  private validInput(): MachineCreateInput | undefined {
    const baseUrl = this.url.trim();
    const name = this.name.trim();
    if (baseUrl === "" || name === "" || machineBaseUrlValidationMessage(baseUrl) !== undefined) return undefined;
    const token = this.connectFrom === "server" ? this.token.trim() : "";
    return { name, baseUrl, connectFrom: this.connectFrom, ...(token === "" ? {} : { token }) };
  }

  override render() {
    if (this.pairing !== undefined) return this.renderWaiting(this.pairing);
    if (this.pairingDenied) return this.renderDenied();
    return this.renderForm();
  }

  private renderForm() {
    const hasUrl = this.url.trim() !== "";
    const urlError = hasUrl ? machineBaseUrlValidationMessage(this.url) : undefined;
    const canSubmit = this.validInput() !== undefined && !this.submitting;
    const name = this.name.trim() === "" ? "the machine" : this.name.trim();
    const submitWords = this.connectFrom === "browser" ? (this.submitting ? "Asking…" : "Request access") : (this.submitting ? "Adding…" : "Add machine");
    return html`
      <form @submit=${(event: SubmitEvent) => { this.handleSubmit(event); }} @keydown=${(event: KeyboardEvent) => { this.handleKeyDown(event); }}>
        <header>
          <strong>Add machine</strong>
          <button type="button" @click=${() => { this.onCancel?.(); }} aria-label="Close">${renderHostCloseIcon()}</button>
        </header>
        <div class="body">
          ${this.submitError === undefined ? null : html`<div class="dialog-error" role="alert">${this.submitError}</div>`}
          <label>
            Remote PI WEB URL
            <input name="baseUrl" type="url" .value=${this.url} @input=${(event: InputEvent) => { this.handleUrlInput(event); }} placeholder="http://dev-box.local:8504" autocomplete="url" inputmode="url" />
          </label>
          <small class=${urlError === undefined ? "hint" : "field-error"}>${urlError ?? "Enter the reachable base URL first, including http:// or https://."}</small>
          ${hasUrl ? html`
            <label>
              Machine name
              <input name="name" type="text" .value=${this.name} @input=${(event: InputEvent) => { this.handleNameInput(event); }} placeholder=${this.previousSuggestedName || "Dev Box"} autocomplete="off" />
            </label>
            <small class="hint">Suggested from the URL. Edit it to use a friendlier sidebar label.</small>
            <div class="connect-from">
              <span class="label" id="connect-from-label">Connect from</span>
              <div class="segments" role="radiogroup" aria-labelledby="connect-from-label">
                ${(["browser", "server"] as const).map((choice) => html`<button type="button" role="radio" aria-checked=${this.connectFrom === choice ? "true" : "false"} class=${this.connectFrom === choice ? "segment chosen" : "segment"} @click=${() => { this.chooseConnection(choice); }}>${choice === "browser" ? "This browser" : "This server"}</button>`)}
              </div>
              <small class="hint">${CONNECT_FROM_HINT[this.connectFrom](name)}</small>
            </div>
            ${this.connectFrom === "server" ? html`
              <label>
                Bearer token <span class="optional">optional</span>
                <input name="token" type="password" .value=${this.token} @input=${(event: InputEvent) => { this.handleTokenInput(event); }} placeholder="Leave blank if the remote machine does not require one" autocomplete="off" />
              </label>
              <small class="hint">Paste only the token value; PI WEB sends it as an Authorization: Bearer header.</small>
            ` : null}
          ` : html`<p class="hint intro">After you enter a URL, PI WEB will suggest a machine name and how to connect to it.</p>`}
        </div>
        <footer>
          <button type="button" @click=${() => { this.onCancel?.(); }}>Cancel</button>
          <button class="primary" type="submit" ?disabled=${!canSubmit}>${submitWords}</button>
        </footer>
      </form>
    `;
  }

  private renderWaiting(pairing: PairingRequest) {
    const input = this.validInput();
    const name = input?.name ?? "the machine";
    const secondsLeft = Math.max(0, Math.ceil((Date.parse(pairing.expiresAt) - this.now) / 1000));
    const countdown = `${String(Math.floor(secondsLeft / 60))}:${String(secondsLeft % 60).padStart(2, "0")}`;
    const waitingWords = pairing.state === "approved" ? (this.submitting ? "Approved · adding the machine…" : "Approved") : `Waiting for approval · expires in ${countdown}`;
    return html`
      <form @submit=${(event: SubmitEvent) => { event.preventDefault(); }}>
        <header>
          <strong>Approve on ${name}</strong>
          <button type="button" @click=${() => { this.onCancel?.(); }} aria-label="Close">${renderHostCloseIcon()}</button>
        </header>
        <div class="body">
          ${this.submitError === undefined ? null : html`<div class="dialog-error" role="alert">${this.submitError}</div>`}
          <p class="hint intro">Open ${name} and approve this page. Check that it shows the same code.</p>
          <p class="code" aria-label=${`Pairing code ${pairing.code.split("").join(" ")}`}>${pairing.code.slice(0, 3)} ${pairing.code.slice(3)}</p>
          ${input === undefined ? null : html`<a class="open primary" href=${approvalUrl(input.baseUrl, pairing.id)} target="_blank" rel="noopener">Open ${name} to approve</a>`}
          <p class="waiting" role="status"><span class="dot" aria-hidden="true"></span>${waitingWords}</p>
        </div>
        <footer>
          <button type="button" @click=${() => { this.onCancel?.(); }}>Cancel</button>
        </footer>
      </form>
    `;
  }

  private renderDenied() {
    const name = this.validInput()?.name ?? "The machine";
    return html`
      <form @submit=${(event: SubmitEvent) => { event.preventDefault(); }}>
        <header>
          <strong>Add machine</strong>
          <button type="button" @click=${() => { this.onCancel?.(); }} aria-label="Close">${renderHostCloseIcon()}</button>
        </header>
        <div class="body">
          <p class="hint intro" role="status">${name} denied this page.</p>
        </div>
        <footer>
          <button type="button" @click=${() => { this.onCancel?.(); }}>Cancel</button>
          <button class="primary" type="button" @click=${() => { this.backToForm(); }}>Back</button>
        </footer>
      </form>
    `;
  }

  static override styles = css`
    :host { color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui, system-ui, sans-serif); line-height: inherit; }
    /* The form is the surface's single slotted child: the section's flex column
       constrains it (min-height: 0 so the body can shrink and scroll). */
    form { display: flex; flex-direction: column; min-height: 0; }
    header, footer { display: flex; align-items: center; justify-content: space-between; gap: var(--pi-space-4); padding: var(--pi-space-6); border-bottom: 1px solid var(--pi-border); }
    footer { border-top: 1px solid var(--pi-border); border-bottom: 0; justify-content: end; }
    .body { display: grid; gap: var(--pi-space-4); padding: var(--pi-space-6); min-height: 0; overflow: auto; }
    label { display: grid; gap: var(--pi-space-3); color: var(--pi-muted); }
    input[type="text"], input[type="url"], input[type="password"], input:not([type]) { box-sizing: border-box; width: 100%; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-bg); color: var(--pi-text); padding: var(--pi-space-5); font: var(--pi-control-font-size, 16px) var(--pi-control-monospace-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); line-height: inherit; }
    input:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-tight); }
    .hint { color: var(--pi-muted); }
    .intro { margin: var(--pi-space-2) 0 0; line-height: 1.4; }
    .optional { color: var(--pi-muted); font-weight: var(--pi-weight-regular); }
    .field-error { color: var(--pi-danger); }
    .connect-from { display: grid; gap: var(--pi-space-3); }
    .connect-from .label { color: var(--pi-muted); }
    .segments { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); overflow: hidden; }
    form .segment { border: 0; border-radius: 0; background: transparent; color: var(--pi-muted); }
    form .segment + .segment { border-left: 1px solid var(--pi-border); }
    form .segment.chosen { background: color-mix(in srgb, var(--pi-accent) 18%, transparent); color: var(--pi-text); box-shadow: inset 0 -2px 0 var(--pi-accent); }
    .code { margin: var(--pi-space-4) 0; text-align: center; font: var(--pi-text-xl) var(--pi-control-monospace-font-family, ui-monospace, monospace); letter-spacing: 0.3em; color: var(--pi-text); }
    .open { display: flex; align-items: center; justify-content: center; box-sizing: border-box; min-height: var(--pi-control-height-comfort); border-radius: var(--pi-radius-md); text-decoration: none; padding: var(--pi-space-4) var(--pi-space-5); }
    .waiting { display: flex; align-items: center; gap: var(--pi-space-3); margin: 0; color: var(--pi-muted); }
    .dot { width: var(--pi-dot-md); height: var(--pi-dot-md); border-radius: 50%; background: var(--pi-warning); }
    .dialog-error { border: 1px solid var(--pi-danger); border-radius: var(--pi-radius-md); background: color-mix(in srgb, var(--pi-danger) 10%, transparent); color: var(--pi-danger); padding: var(--pi-space-5); line-height: 1.35; }
    form button { font: inherit; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-4) var(--pi-space-5); cursor: pointer; }
    header button { display: grid; place-items: center; box-sizing: border-box; width: var(--pi-control-height-comfort); height: var(--pi-control-height-comfort);  line-height: 1; border: 0; background: transparent; color: var(--pi-muted); font-size: var(--pi-text-xl); padding: 0; }
    .primary { border-color: var(--pi-accent); background: var(--pi-accent); color: var(--pi-on-accent, var(--pi-bg)); }
    button:disabled { opacity: var(--pi-disabled-opacity); cursor: not-allowed; }
    /* Coarse pointers get the comfort floor: this dialog shipped 33px footer
       buttons and a 22x30 close next to a sibling dialog that raised both. */
    @media (pointer: coarse) {
      footer button, form .segment, .open { min-height: var(--pi-control-height-touch, 44px); }
      header button { width: var(--pi-control-height-touch, 44px); height: var(--pi-control-height-touch, 44px); padding: 0; }
      input[type="text"], input[type="url"], input[type="password"], input:not([type]) { min-height: var(--pi-control-height-touch, 44px); }
    }
  `;
}

export function suggestedMachineNameFromUrl(value: string): string {
  const raw = value.trim();
  if (raw === "") return "";
  const parsed = parseUrlForSuggestion(raw) ?? parseUrlForSuggestion(`http://${raw.replace(/^\/+/u, "")}`);
  if (parsed !== undefined && parsed.hostname !== "") return parsed.hostname.replace(/^\[(.*)\]$/u, "$1");
  return fallbackSuggestedName(raw);
}

export function machineBaseUrlValidationMessage(value: string): string | undefined {
  const raw = value.trim();
  if (raw === "") return "Remote PI WEB URL is required.";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Enter a valid URL including http:// or https://.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "Use an http:// or https:// URL.";
  if (url.username !== "" || url.password !== "") return "Do not include credentials in the machine URL.";
  if (url.search !== "" || url.hash !== "") return "Do not include a query string or fragment.";
  return undefined;
}

function parseUrlForSuggestion(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

function fallbackSuggestedName(value: string): string {
  const withoutProtocol = value.replace(/^[a-z][a-z\d+.-]*:\/\//iu, "");
  const withoutCredentials = withoutProtocol.slice(withoutProtocol.lastIndexOf("@") + 1);
  const host = withoutCredentials.split(/[/?#]/u)[0] ?? "";
  if (host.startsWith("[") && host.includes("]")) return host.slice(1, host.indexOf("]"));
  return host.replace(/:\d+$/u, "");
}

if (customElements.get("machine-dialog") === undefined) customElements.define("machine-dialog", MachineDialog);
