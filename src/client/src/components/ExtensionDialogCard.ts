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
 * A line too long for the header is PARTITIONED, not repeated: the heading
 * carries the first words (elided at a word boundary) and the body carries
 * the rest, so the reader never meets the same sentence twice. Pure so the
 * split is unit-testable without rendering.
 */
export function splitDialogTitle(title: string): DialogTitleParts {
  const normalized = title.replace(/\r\n/g, "\n").replace(/^\n+/, "").trimEnd();
  const newlineIndex = normalized.indexOf("\n");
  if (newlineIndex === -1) return splitLongLine(normalized);
  const firstLine = normalized.slice(0, newlineIndex).trimEnd();
  const rest = normalized.slice(newlineIndex + 1);
  if (firstLine.length <= DIALOG_HEADING_MAX_LENGTH) return { heading: firstLine, body: rest };
  const parts = splitLongLine(firstLine);
  return { heading: parts.heading, body: `${parts.body ?? ""}\n${rest}` };
}

function splitLongLine(line: string): DialogTitleParts {
  if (line.length <= DIALOG_HEADING_MAX_LENGTH) return { heading: line };
  const spaceIndex = line.lastIndexOf(" ", DIALOG_HEADING_MAX_LENGTH);
  const splitAt = spaceIndex > 0 ? spaceIndex : DIALOG_HEADING_MAX_LENGTH;
  return { heading: `${line.slice(0, splitAt).trimEnd()}\u2026`, body: line.slice(splitAt).trimStart() };
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
    // A settled dialog needs nothing further from the reader, whatever the
    // reason it settled: the outcome is one quiet row the transcript keeps,
    // with no Dismiss to tap. Only the answered branch got this in the first
    // pass, and every cancelled or timed-out update dialog kept charging a
    // second interaction for a fact that had already settled - reported by
    // the owner more than ten times before this branch joined the same law.
    return this.renderAnsweredRow(closed);
  }

  private renderAnsweredRow(closed: ClosedExtensionDialog): TemplateResult {
    return html`
      <article class="answered-row" aria-labelledby="extension-dialog-answered-heading">
        <span class=${`header-status ${closed.reason}`}>${extensionDialogCloseLabel(closed.reason)}</span>
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
      margin: 0 0 var(--pi-space-7);
      color: var(--pi-text);
      font: var(--pi-text-base) var(--pi-font-ui, system-ui, sans-serif); line-height: inherit;
      container-type: inline-size;
    }
    /* One corner owner: the card clips, children paint square (the .msg
       contract; a child replicating the curve is what broke the corners). */
    .card {
      border: 1px solid var(--pi-border);
      border-radius: var(--pi-radius-lg);
      overflow: hidden;
      overflow: clip;
      background: var(--pi-surface-raised);
      box-shadow: var(--pi-elevation-3);
      /* The waiting-slot contract: fill the slot's height budget as a column
         whose detail is the one scroller and whose actions never scroll
         away. */
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--pi-space-6);
      min-height: 22px;
      padding: var(--pi-space-4) var(--pi-space-7) var(--pi-space-4);
      border-bottom: 1px solid var(--pi-border-muted);
      background: var(--pi-surface-raised);
      box-shadow: var(--pi-elevation-2);
    }
    h2, p { margin-top: 0; }
    h2 {
      min-width: 0;
      margin-bottom: 0;
      font-size: var(--pi-text-base);
      font-weight: var(--pi-weight-strong);
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .header-status { flex: 0 0 auto; color: var(--pi-muted); font-size: var(--pi-text-2xs); text-align: end; }
    .header-status { color: var(--pi-text); display: inline-flex; align-items: center; gap: var(--pi-space-3); }
    .header-status::before { content: ""; width: var(--pi-dot-sm); height: var(--pi-dot-sm); border-radius: 50%; background: currentColor; }
    .header-status.answered::before { background: var(--pi-success); }
    .header-status.cancelled::before { background: var(--pi-warning); }
    .header-status.answered { color: var(--pi-success); }
    .header-status.timeout, .header-status.aborted, .header-status.session-ended { color: var(--pi-warning); }
    .dialog-message {
      margin: 0;
      padding: var(--pi-space-6) var(--pi-space-7);
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
      padding: var(--pi-space-6) var(--pi-space-7);
      font-size: var(--pi-text-sm);
      line-height: 1.45;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      /* The one scroller of the card: the slot's height budget lands here,
         so long details scroll internally and the action row stays on
         screen. */
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior-y: contain;
    }
    .dialog-detail:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-inset); }
    .dialog-options {
      display: grid;
      gap: var(--pi-space-4);
      padding: var(--pi-space-6) var(--pi-space-7);
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
    .option-button:active:not(:disabled) { border-color: var(--pi-accent); background: var(--pi-surface-active); }
    .dialog-input-form { display: grid; }
    .dialog-input {
      box-sizing: border-box;
      width: calc(100% - 32px);
      margin: var(--pi-space-6) var(--pi-space-7) 0;
      border: 1px solid var(--pi-border);
      border-radius: var(--pi-radius-md);
      background: var(--pi-bg);
      color: var(--pi-text);
      padding: var(--pi-space-4);
      font: var(--pi-control-font-size, 16px)/1.4 var(--pi-control-font-family, system-ui, sans-serif); line-height: inherit;
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
      gap: var(--pi-space-4);
      border-top: 1px solid var(--pi-border-muted);
      background: var(--pi-surface);
      padding: var(--pi-space-6) var(--pi-space-7);
    }
    .dialog-message + .dialog-footer, .dialog-options + .dialog-footer { border-top: 0; }
    /* Buttons ghost on the tinted card: outlined pills stacked four deep read
       as a wall of boxes inside an already-boxed card. Hover, active, and the
       primary action's fill keep the affordances (C2/C4/C6). */
    button { box-sizing: border-box;
      border: 1px solid var(--pi-border);
      border-radius: var(--pi-radius-md);
      background: var(--pi-surface-hover);
      color: var(--pi-text);
      padding: var(--pi-space-4) var(--pi-space-6);
      font: inherit;
      cursor: pointer;
    }
    @media (hover: hover) { button:hover:not(:disabled) { background: var(--pi-surface-hover); } }
    button:active:not(:disabled) { background: var(--pi-surface-active); }
    button:disabled { cursor: wait; opacity: var(--pi-disabled-opacity); }
    button:focus-visible, .dialog-input:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset); }
    .primary-action { border-color: var(--pi-accent); background: var(--pi-accent); color: var(--pi-on-accent, var(--pi-bg)); font-weight: var(--pi-weight-strong); }
    @media (hover: hover) { .primary-action:hover:not(:disabled) { background: color-mix(in srgb, var(--pi-accent) 86%, white); } }
    .primary-action:active:not(:disabled) { background: color-mix(in srgb, var(--pi-accent) 86%, white); }
    .answered-row {
      display: flex;
      align-items: baseline;
      gap: var(--pi-space-4);
      min-width: 0;
      padding: var(--pi-space-3) var(--pi-space-6);
      border: 1px solid var(--pi-border-muted);
      border-radius: var(--pi-radius-md);
      background: var(--pi-surface);
    }
    .answered-row h2 {
      min-width: 0;
      margin: 0;
      font-size: var(--pi-text-xs);
      font-weight: var(--pi-weight-semibold);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .answered-row .answered-answer {
      min-width: 0;
      margin: 0;
      color: var(--pi-muted);
      font-size: var(--pi-text-xs);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .answered-row .header-status { flex: 0 0 auto; }
    /* A control a person taps is a touch target wherever the card is shown, as
       the ask-user card beside it in the same transcript already states. */
    .primary-action, .secondary-action, .option-button, .dialog-input { min-height: var(--pi-control-height-touch); }
    @container (max-width: 580px) {
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
