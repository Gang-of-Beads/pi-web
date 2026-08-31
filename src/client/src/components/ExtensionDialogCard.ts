import { LitElement, css, html, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import {
  EXTENSION_DIALOG_INPUT_MAX_LENGTH,
  type ExtensionDialogAnswer,
  type ExtensionDialogCloseReason,
  type PendingExtensionDialog,
} from "../../../shared/apiTypes";
import type { ClosedExtensionDialog } from "../appState";

export type ExtensionDialogAnswerCallback = (dialogId: string, value: ExtensionDialogAnswer) => void | Promise<void>;
export type ExtensionDialogCancelCallback = (dialogId: string) => void | Promise<void>;
export type ExtensionDialogDismissCallback = (dialogId: string) => void;

const COUNTDOWN_TICK_MS = 1_000;

/**
 * Longest heading kept in the card header. Beyond this the heading is
 * elided and the untouched title moves into the scrollable detail body.
 */
const DIALOG_HEADING_MAX_LENGTH = 120;

/** A dialog title split into a header line and an optional scrollable detail body. */
export interface DialogTitleParts {
  heading: string;
  body?: string;
}

/**
 * Split a dialog title into a one-line heading and an optional detail body.
 *
 * `ctx.ui.select()` and `ctx.ui.input()` offer a single text slot, so an
 * extension that needs to present a structured document (a goal contract, a
 * migration plan) has nowhere to put it but `title`. Rendering that verbatim
 * in the card header buries the viewport on a phone and collapses every
 * newline, so only the first line stays in the header while the remainder
 * becomes a scrollable body that preserves its line breaks.
 *
 * Pure so the split is unit-testable without rendering.
 */
export function splitDialogTitle(title: string): DialogTitleParts {
  const normalized = title.replace(/\r\n/g, "\n").replace(/^\n+/, "").trimEnd();
  const newlineIndex = normalized.indexOf("\n");
  if (newlineIndex === -1) {
    // A single line that still cannot fit the header keeps its full text in the
    // body, so eliding the heading never loses characters.
    if (normalized.length <= DIALOG_HEADING_MAX_LENGTH) return { heading: normalized };
    return { heading: `${normalized.slice(0, DIALOG_HEADING_MAX_LENGTH).trimEnd()}\u2026`, body: normalized };
  }
  const firstLine = normalized.slice(0, newlineIndex).trimEnd();
  const headingFits = firstLine.length <= DIALOG_HEADING_MAX_LENGTH;
  const heading = headingFits ? firstLine : `${firstLine.slice(0, DIALOG_HEADING_MAX_LENGTH).trimEnd()}\u2026`;
  // An elided first line is repeated inside the body; a fitting one is not.
  const body = headingFits ? normalized.slice(newlineIndex + 1).replace(/\n+$/, "") : normalized;
  return body.trim() === "" ? { heading } : { heading, body };
}

/** Header status label for a closed extension dialog. */
export function extensionDialogCloseLabel(reason: ExtensionDialogCloseReason): string {
  switch (reason) {
    case "answered": return "Answered";
    case "cancelled": return "Cancelled";
    case "timeout": return "Timed out";
    case "aborted": return "Aborted";
    case "session-ended": return "Session ended";
  }
}

/** One-line summary of what a closed dialog resolved to, for the outcome card. */
export function extensionDialogCloseSummary(closed: ClosedExtensionDialog): string {
  switch (closed.reason) {
    case "answered": {
      const answer = closed.answer;
      // An answered close without an answer value breaks the wire contract;
      // the card still renders rather than crashing the transcript.
      if (answer === undefined) return "Closed without an answer.";
      if (typeof answer === "boolean") return `Answered: ${answer ? "Yes" : "No"}`;
      return answer === "" ? "Answered with an empty response." : `Answered: ${answer}`;
    }
    case "cancelled": return "Dismissed without an answer.";
    case "timeout": return "No answer was given before the dialog timed out.";
    case "aborted": return "The run ended before this dialog was answered.";
    case "session-ended": return "The session ended before this dialog was answered.";
  }
}

/**
 * Remaining-time label for an open dialog's auto-cancel deadline. Display
 * only: the daemon owns the real timeout and publishes `dialog.closed`, so a
 * card whose countdown reaches zero simply waits for that event.
 */
export function extensionDialogCountdownText(timeoutAt: string | undefined, nowMs: number): string | undefined {
  if (timeoutAt === undefined) return undefined;
  const deadline = Date.parse(timeoutAt);
  if (!Number.isFinite(deadline)) return undefined;
  const remainingMs = deadline - nowMs;
  if (remainingMs <= 0) return "Auto-cancel imminent";
  const seconds = Math.ceil(remainingMs / 1000);
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    // Floor, not round: rounding yields "1h 60m" in the last half-minute of an hour.
    const minutes = Math.floor((seconds % 3600) / 60);
    return `Auto-cancels in ${String(hours)}h ${String(minutes)}m`;
  }
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    return `Auto-cancels in ${String(minutes)}m ${String(seconds % 60)}s`;
  }
  return `Auto-cancels in ${String(seconds)}s`;
}

/**
 * One extension dialog opened by `ctx.ui.confirm()`, `ctx.ui.select()`, or
 * `ctx.ui.input()`.
 *
 * The card owns only browser-local form state (the half-typed input, the
 * in-flight close flag, the display-only countdown); the daemon remains the
 * source of truth for whether the dialog is open. Closed mode renders the
 * settled outcome — a browser-local record that stays until dismissed — for a
 * browser that saw the dialog open.
 */
@customElement("extension-dialog-card")
export class ExtensionDialogCard extends LitElement {
  @property({ attribute: false }) dialog?: PendingExtensionDialog;
  @property({ attribute: false }) outcome?: ClosedExtensionDialog;
  @property({ attribute: false }) onAnswer?: ExtensionDialogAnswerCallback;
  @property({ attribute: false }) onCancel?: ExtensionDialogCancelCallback;
  @property({ attribute: false }) onDismiss?: ExtensionDialogDismissCallback;

  @state() private inputValue = "";
  @state() private closing = false;
  @state() private countdownNow = 0;
  private dialogIdentity: string | undefined;
  private countdownTimer: number | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    this.syncCountdownTimer();
  }

  override disconnectedCallback(): void {
    this.stopCountdownTimer();
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("dialog") && !changed.has("outcome")) return;
    // Identity is keyed by dialogId, not object identity: status refreshes
    // re-project the same open dialog as a new object and must not wipe a
    // half-typed answer or an in-flight close.
    const identity = this.currentIdentity();
    if (identity !== this.dialogIdentity) {
      this.dialogIdentity = identity;
      this.inputValue = "";
      this.closing = false;
    }
    this.syncCountdownTimer();
  }

  override render(): TemplateResult | null {
    if (this.outcome !== undefined) return this.renderClosed(this.outcome);
    if (this.dialog !== undefined) return this.renderOpen(this.dialog);
    return null;
  }

  private renderOpen(dialog: PendingExtensionDialog): TemplateResult {
    const countdown = extensionDialogCountdownText(dialog.timeoutAt, this.countdownNow === 0 ? Date.now() : this.countdownNow);
    const { heading, body } = splitDialogTitle(dialog.title);
    return html`
      <article class="card open-card" aria-labelledby="extension-dialog-heading">
        <header class="card-header">
          <h2 id="extension-dialog-heading">${heading}</h2>
          ${countdown === undefined
            ? null
            // Decorative only — no live region: a polite region would queue one
            // announcement per second. The daemon-owned dialog.closed event is
            // the real signal, and the settled card announces the outcome.
            : html`<span class="header-status countdown">${countdown}</span>`}
        </header>
        ${body === undefined
          ? null
          // Focusable so the detail scrolls by keyboard as well as by touch;
          // the group role keeps it out of the heading's accessible name.
          : html`<div class="dialog-detail" role="group" aria-label="Details" tabindex="0">${body}</div>`}
        ${this.renderOpenBody(dialog)}
      </article>
    `;
  }

  private renderOpenBody(dialog: PendingExtensionDialog): TemplateResult {
    if (dialog.kind === "select") return this.renderSelectBody(dialog);
    if (dialog.kind === "input") return this.renderInputBody(dialog);
    return this.renderConfirmBody(dialog);
  }

  private renderConfirmBody(dialog: PendingExtensionDialog): TemplateResult {
    return html`
      ${dialog.message === undefined ? null : html`<p class="dialog-message">${dialog.message}</p>`}
      <footer class="dialog-footer">
        <button class="secondary-action" type="button" ?disabled=${this.closing} @click=${() => { this.cancelDialog(dialog); }}>Cancel</button>
        <button class="secondary-action" type="button" ?disabled=${this.closing} @click=${() => { this.answerDialog(dialog, false); }}>No</button>
        <button class="primary-action" type="button" ?disabled=${this.closing} @click=${() => { this.answerDialog(dialog, true); }}>Yes</button>
      </footer>
    `;
  }

  private renderSelectBody(dialog: PendingExtensionDialog): TemplateResult {
    return html`
      <div class="dialog-options" role="group" aria-label="Choices">
        ${(dialog.options ?? []).map((option) => html`
          <button class="option-button" type="button" ?disabled=${this.closing} @click=${() => { this.answerDialog(dialog, option); }}>${option}</button>
        `)}
      </div>
      <footer class="dialog-footer">
        <button class="secondary-action" type="button" ?disabled=${this.closing} @click=${() => { this.cancelDialog(dialog); }}>Cancel</button>
      </footer>
    `;
  }

  private renderInputBody(dialog: PendingExtensionDialog): TemplateResult {
    return html`
      <form class="dialog-input-form" @submit=${(event: SubmitEvent) => { this.submitInput(event, dialog); }}>
        <input
          class="dialog-input"
          type="text"
          name="dialog-answer"
          aria-label="Your answer"
          placeholder=${ifDefined(dialog.placeholder)}
          maxlength=${String(EXTENSION_DIALOG_INPUT_MAX_LENGTH)}
          .value=${this.inputValue}
          ?disabled=${this.closing}
          @input=${(event: Event) => { this.changeInput(event); }}
        />
        <footer class="dialog-footer">
          <button class="secondary-action" type="button" ?disabled=${this.closing} @click=${() => { this.cancelDialog(dialog); }}>Cancel</button>
          <button class="primary-action" type="submit" ?disabled=${this.closing}>${this.closing ? "Sending…" : "Send"}</button>
        </footer>
      </form>
    `;
  }

  private renderClosed(closed: ClosedExtensionDialog): TemplateResult {
    // An answered dialog needs nothing further from the reader, so it stops
    // being a card: the outcome is one quiet row the transcript keeps, with no
    // Dismiss to tap. Requiring that tap made every answer cost a second
    // interaction and left a live button on a settled fact; the durable record
    // is the notification the daemon files in the drawer.
    if (closed.reason === "answered") return this.renderAnsweredRow(closed);
    return html`
      <article class="card closed-card" aria-labelledby="extension-dialog-closed-heading">
        <header class="card-header">
          <h2 id="extension-dialog-closed-heading">${splitDialogTitle(closed.dialog.title).heading}</h2>
          <span class=${`header-status ${closed.reason}`}>${extensionDialogCloseLabel(closed.reason)}</span>
        </header>
        <p class="closed-summary">${extensionDialogCloseSummary(closed)}</p>
        <footer class="dialog-footer">
          <button class="secondary-action" type="button" @click=${() => { this.dismissClosed(closed); }}>Dismiss</button>
        </footer>
      </article>
    `;
  }

  private renderAnsweredRow(closed: ClosedExtensionDialog): TemplateResult {
    return html`
      <article class="answered-row" aria-labelledby="extension-dialog-answered-heading">
        <span class="header-status answered">Answered</span>
        <h2 id="extension-dialog-answered-heading">${splitDialogTitle(closed.dialog.title).heading}</h2>
        <p class="answered-answer">${extensionDialogCloseSummary(closed)}</p>
      </article>
    `;
  }

  private answerDialog(dialog: PendingExtensionDialog, value: ExtensionDialogAnswer): void {
    this.closeWith(dialog, () => this.onAnswer?.(dialog.dialogId, value));
  }

  private cancelDialog(dialog: PendingExtensionDialog): void {
    this.closeWith(dialog, () => this.onCancel?.(dialog.dialogId));
  }

  private submitInput(event: SubmitEvent, dialog: PendingExtensionDialog): void {
    event.preventDefault();
    // An empty string is a valid input answer, so Send stays enabled.
    this.answerDialog(dialog, this.inputValue);
  }

  private closeWith(dialog: PendingExtensionDialog, close: () => void | Promise<void>): void {
    if (this.closing) return;
    this.closing = true;
    const dialogId = dialog.dialogId;
    void Promise.resolve()
      .then(close)
      .catch(() => {
        // The parent controller owns the visible transport error. Keeping this
        // card usable is the only recovery needed at this boundary.
      })
      .finally(() => {
        if (this.dialog?.dialogId === dialogId) this.closing = false;
      });
  }

  private changeInput(event: Event): void {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    this.inputValue = input.value;
  }

  private dismissClosed(closed: ClosedExtensionDialog): void {
    this.onDismiss?.(closed.dialog.dialogId);
  }

  private currentIdentity(): string | undefined {
    if (this.outcome !== undefined) return `closed:${this.outcome.dialog.dialogId}`;
    if (this.dialog !== undefined) return `open:${this.dialog.dialogId}`;
    return undefined;
  }

  private syncCountdownTimer(): void {
    const needsTick = this.isConnected && this.outcome === undefined && this.dialog?.timeoutAt !== undefined;
    if (needsTick && this.countdownTimer === undefined) {
      this.countdownNow = Date.now();
      // Surface backed up: the dialog's countdown readout. A display tick over
      // the timeout the server already enforces.
      this.countdownTimer = window.setInterval(() => { this.countdownNow = Date.now(); }, COUNTDOWN_TICK_MS);
      return;
    }
    if (!needsTick) this.stopCountdownTimer();
  }

  private stopCountdownTimer(): void {
    if (this.countdownTimer === undefined) return;
    window.clearInterval(this.countdownTimer);
    this.countdownTimer = undefined;
  }

  static override styles = css`
    /* This card is its own shadow root, so the transcript's tap rules do not
       reach it: without these, the option buttons stay eligible for the
       browser's double-tap-zoom click delay and paint the platform's rectangular
       tap highlight. */
    button, [role="button"], input, select, summary { -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
    :host {
      display: block;
      box-sizing: border-box;
      width: 100%;
      margin: 0 0 14px;
      color: var(--pi-text);
      font: 14px system-ui, sans-serif;
      container-type: inline-size;
    }
    .card {
      border: 1px solid var(--pi-border);
      border-radius: 10px;
      background: var(--pi-surface);
    }
    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 22px;
      padding: 8px 16px 7px;
      border-bottom: 1px solid var(--pi-border-muted);
      border-radius: 9px 9px 0 0;
      background: var(--pi-surface);
      box-shadow: 0 8px 18px var(--pi-shadow-soft);
    }
    h2, p { margin-top: 0; }
    h2 {
      min-width: 0;
      margin-bottom: 0;
      font-size: 14px;
      font-weight: 650;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .header-status { flex: 0 0 auto; color: var(--pi-muted); font-size: 11px; text-align: end; }
    .header-status.answered { color: var(--pi-success); }
    .header-status.timeout, .header-status.aborted, .header-status.session-ended { color: var(--pi-warning); }
    .dialog-message {
      margin: 0;
      padding: 12px 16px;
      line-height: 1.4;
      /* Structured messages arrive with their own line breaks; collapsing them
         turns a formatted plan into an unreadable run-on paragraph. */
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      border-bottom: 1px solid var(--pi-border-muted);
    }
    .dialog-message + .dialog-message { border-bottom: 0; }
    .dialog-detail {
      border-bottom: 1px solid var(--pi-border-muted);
      padding: 12px 16px;
      font-size: 13px;
      line-height: 1.45;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      /* The one inner scroller of the card: long details (task lists, contracts)
         cap here so the action row below stays on screen without scrolling the
         whole card — nested scrollers in a 45vh slot put the confirm buttons
         out of a thumb's reach. */
      max-height: 40vh;
      overflow-y: auto;
      overscroll-behavior-y: contain;
    }
    .dialog-detail:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -2px; }
    .dialog-options {
      display: grid;
      gap: 7px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--pi-border-muted);
    }
    .option-button {
      display: block;
      width: 100%;
      text-align: start;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    @media (hover: hover) { .option-button:hover:not(:disabled) { border-color: var(--pi-accent); background: var(--pi-surface-hover); } }
    /* Pressed feedback lives on the active state, not on hover: on a coarse
       pointer the hover state is what made the browser withhold the first
       click. */
    .option-button:active:not(:disabled) { border-color: var(--pi-accent); background: var(--pi-surface-hover); }
    .dialog-input-form { display: grid; }
    .dialog-input {
      box-sizing: border-box;
      width: calc(100% - 32px);
      margin: 12px 16px 0;
      border: 1px solid var(--pi-border);
      border-radius: 8px;
      background: var(--pi-bg);
      color: var(--pi-text);
      padding: 8px;
      font: var(--pi-control-font-size, 16px)/1.4 var(--pi-control-font-family, system-ui, sans-serif);
    }
    .dialog-footer {
      /* The card sits in the transcript, which is already the scroller. The
         footer and header therefore read from normal document flow, at every
         pointer type: the owner's decision is "手机和桌面都回文档流，桌面也不悬浮"
         - phones and desktop both return to document flow, desktop does not
         float either. A bottom-sticky footer is held at the viewport bottom
         for as long as the card's end is below the fold, so it necessarily
         covers the card's own earlier rows - and in a select dialog those rows
         are the options. Measured at 1440x900 with a 12-option dialog while
         the footer was still sticky on fine pointers: at scrollTop 0 the
         footer stayed pinned at y=845 and document hit-testing put Options 7
         and 8 under it, and at deeper scrolls the pinned header covered Skip
         and Option 4. Reaching the wrong answer is worse than reaching
         nothing, and no pointer gets a hover that reliably reveals the
         overlap first. Nothing is lost by scrolling to the controls: the card
         has no inner scroller, the transcript is the scroller, which is what
         the sticky was avoiding in the first place. */
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      border-top: 1px solid var(--pi-border-muted);
      border-radius: 0 0 9px 9px;
      background: var(--pi-surface);
      padding: 12px 16px;
    }
    .dialog-message + .dialog-footer, .dialog-options + .dialog-footer { border-top: 0; }
    button {
      border: 1px solid var(--pi-border);
      border-radius: 8px;
      background: var(--pi-surface);
      color: var(--pi-text);
      padding: 7px 12px;
      font: inherit;
      cursor: pointer;
    }
    @media (hover: hover) { button:hover:not(:disabled) { background: var(--pi-surface-hover); } }
    button:active:not(:disabled) { background: var(--pi-surface-hover); }
    button:disabled { cursor: wait; opacity: .65; }
    button:focus-visible, .dialog-input:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 2px; }
    .primary-action { border-color: var(--pi-accent); background: var(--pi-accent); color: var(--pi-accent-contrast, white); font-weight: 650; }
    @media (hover: hover) { .primary-action:hover:not(:disabled) { background: color-mix(in srgb, var(--pi-accent) 86%, white); } }
    .primary-action:active:not(:disabled) { background: color-mix(in srgb, var(--pi-accent) 86%, white); }
    .closed-summary {
      margin: 0;
      padding: 12px 16px;
      color: var(--pi-muted);
      font-size: 13px;
      line-height: 1.4;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .answered-row {
      display: flex;
      align-items: baseline;
      gap: 8px;
      min-width: 0;
      padding: 6px 12px;
      border: 1px solid var(--pi-border-muted);
      border-radius: 8px;
      background: var(--pi-surface);
    }
    .answered-row h2 {
      min-width: 0;
      margin: 0;
      font-size: 12px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .answered-row .answered-answer {
      min-width: 0;
      margin: 0;
      color: var(--pi-muted);
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .answered-row .header-status { flex: 0 0 auto; }
    @container (max-width: 580px) {
      /* Every actionable control is a touch target on a phone, not just the
         primary one: the options are the whole point of a select dialog. */
      .primary-action, .secondary-action, .option-button { min-height: 42px; }
      /* A cap alone contains nothing: overflow is visible by default, so the
         text kept painting past the bottom of its box and straight through the
         option buttons below it. A goal draft showed its wording between and
         behind the answers. A height limit has to say what happens to what
         does not fit. */
      .dialog-detail { max-height: min(40vh, 320px); overflow-y: auto; overscroll-behavior: contain; }
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "extension-dialog-card": ExtensionDialogCard;
  }
}
