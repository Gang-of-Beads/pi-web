import { LitElement, css, html, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { dialogCardNeedsRender } from "../cardIdentity";
import { ifDefined } from "lit/directives/if-defined.js";
import { live } from "lit/directives/live.js";
import {
  EXTENSION_DIALOG_EDITOR_MAX_LENGTH,
  EXTENSION_DIALOG_INPUT_MAX_LENGTH,
  type ExtensionDialogAnswer,
  type ExtensionDialogScreen,
  type PendingExtensionDialog,
  type ScreenLine,
  type ScreenSpan,
} from "../../../shared/apiTypes";
import { dialogScreenKey } from "../dialogScreenKey.js";
import { isScreenHintLine, isSelectableLine, keysForLineTap, screenIsTappable } from "../dialogScreenKeys.js";
import { asksForWidth, screenColumns, type WidthReason } from "../screenColumns.js";
import { classifyScreen, type ScreenShape } from "../dialogScreenShape.js";
import { shouldSendPromptOnEnterShortcut, shouldUsePromptEnterShiftShortcut } from "../promptEnterBehavior";
import { keyBelongsToInputMethod } from "./keyboardEventTarget";
import { clearDialogAnswerDraft, loadDialogAnswerDraft, saveDialogAnswerDraft } from "../dialogAnswerDrafts";
import "./InteractiveCard";
import type { CardSubmission } from "../../../shared/interactiveCard";

export type ExtensionDialogAnswerCallback = (dialogId: string, value: ExtensionDialogAnswer) => void | Promise<void>;
export type ExtensionDialogCancelCallback = (dialogId: string) => void | Promise<void>;
/** A keypress for a `custom` screen's component. */
export type ExtensionDialogKeyCallback = (dialogId: string, key: string) => void | Promise<void>;
/** A tapped line of a `custom` screen, by its number and its text; the daemon walks the cursor there. */
export type ExtensionDialogLineCallback = (dialogId: string, line: number, text: string) => void | Promise<void>;
/** The columns a `custom` screen's card has room for; the daemon draws the extension at that width. */
export type ExtensionDialogWidthCallback = (dialogId: string, width: number) => void | Promise<void>;

const COUNTDOWN_TICK_MS = 1_000;

/** The classes a styled run of a drawn screen takes: its pi roles and its emphasis. */
function screenSpanClass(span: ScreenSpan): string {
  return [
    span.fg === undefined ? "" : `fg-${span.fg}`,
    span.bg === undefined ? "" : `bg-${span.bg}`,
    span.bold === true ? "bold" : "",
    span.dim === true ? "dim" : "",
    span.italic === true ? "italic" : "",
    span.underline === true ? "underline" : "",
    span.inverse === true ? "inverse" : "",
    span.strike === true ? "strike" : "",
  ].filter((name) => name !== "").join(" ");
}

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

/** The heading of a dialog whose extension gave it no title. */
const UNTITLED_DIALOG_HEADING = "An extension is asking";
const NO_CHOICES_TEXT = "This question offers no choices.";
const BLANK_OPTION_LABEL = "(blank)";

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
  if (normalized === "") return { heading: UNTITLED_DIALOG_HEADING };
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

/** Says what the daemon cut from an editor's opening text, so the reader knows Send returns only what is shown. */
function editorCutText(cut: number): string {
  return `The extension's text was longer: the last ${cut.toLocaleString()} characters are not here, and Send returns only what is.`;
}

/** A terminal screen that reads as a menu is headed by its own first line, not "Extension screen". */
function screenHeading(shape: ScreenShape | undefined): string | undefined {
  return shape?.kind === "menu" ? shape.title : undefined;
}

/**
 * One extension dialog opened by `ctx.ui.confirm()`, `ctx.ui.select()`,
 * `ctx.ui.input()`, `ctx.ui.editor()` or `ctx.ui.custom()`.
 *
 * The card owns only browser-local form state (the half-typed input, the
 * in-flight close flag, the display-only countdown); the daemon remains the
 * source of truth for whether the dialog is open. A closed dialog leaves no
 * card (state-diagram D2): what became of it is the tool row's, as in pi.
 */
@customElement("extension-dialog-card")
export class ExtensionDialogCard extends LitElement {
  @property({ attribute: false }) dialog?: PendingExtensionDialog;

  /**
   * A streaming turn re-delivers the same pending dialog as a fresh object on
   * every status frame; rebuilding the form under the reader is the shake the
   * ask card was fixed for, and this card sits in the same slot.
   */
  protected override shouldUpdate(changed: PropertyValues<this>): boolean {
    if (changed.size !== 1 || !changed.has("dialog")) return true;
    return dialogCardNeedsRender(changed.get("dialog"), this.dialog);
  }
  @property({ attribute: false }) onAnswer?: ExtensionDialogAnswerCallback;
  @property({ attribute: false }) onCancel?: ExtensionDialogCancelCallback;
  @property({ attribute: false }) onKey?: ExtensionDialogKeyCallback;
  @property({ attribute: false }) onLine?: ExtensionDialogLineCallback;
  @property({ attribute: false }) onWidth?: ExtensionDialogWidthCallback;
  /** Machine-scoped session key under which this browser keeps a half-given answer (interactive card, input or editor dialog) across a reload; empty keeps none. */
  @property({ attribute: false }) draftSessionId = "";

  @state() private inputValue = "";
  @state() private closing = false;
  @state() private countdownNow = 0;
  /** The option the reader chose on a terminal menu, for the dialog it belongs to; until then the component's own cursor. */
  @state() private screenChoice: { dialogId: string; line: number } | undefined;
  /** A Shift the keyboard really pressed; see promptEnterBehavior.ts (the composer tracks the same). */
  private explicitShiftKeyActive = false;
  private dialogIdentity: string | undefined;
  /** What this card has sent to the open screen since its last Enter; every edit of the field is sent as its difference from this. */
  private screenTyped = "";
  /** The screen's keys in the order they were typed: each waits for the one before, so a fast typist's keys never interleave. */
  private screenKeys: Promise<void> = Promise.resolve();
  private countdownTimer: number | undefined;
  /** Watches the drawn screen (.dialog-screen) for changes to its width; one per card, re-observed when the element is replaced. */
  private screenObserver: ResizeObserver | undefined;
  /** The .dialog-screen element screenObserver currently watches. */
  private observedScreen: Element | undefined;
  /** The screen element's clientWidth in CSS pixels at the last resize callback, so an unchanged pixel width does not ask again; not columns. */
  private observedWidth: number | undefined;
  /** The columns this card last asked the open screen to draw at, and the dialogId it asked, so asksForWidth's "measured" reason does not repeat a request for the same dialog. */
  private askedWidth: { dialogId: string; width: number } | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    this.syncCountdownTimer();
  }

  override disconnectedCallback(): void {
    this.screenObserver?.disconnect();
    this.screenObserver = undefined;
    this.observedScreen = undefined;
    this.stopCountdownTimer();
    super.disconnectedCallback();
  }

  protected override updated(): void {
    this.observeScreen();
  }

  private observeScreen(): void {
    const screen = this.renderRoot.querySelector(".dialog-screen") ?? undefined;
    if (screen === this.observedScreen) return;
    this.screenObserver?.disconnect();
    this.screenObserver = undefined;
    this.observedScreen = screen;
    this.observedWidth = undefined;
    if (screen === undefined || typeof ResizeObserver === "undefined") return;
    this.screenObserver = new ResizeObserver(() => { this.screenResized(); });
    this.screenObserver.observe(screen);
  }

  private screenResized(): void {
    const width = this.observedScreen?.clientWidth;
    if (width === undefined || width === this.observedWidth) return;
    this.observedWidth = width;
    this.askForWidth("measured");
  }

  private askForWidth(reason: WidthReason): void {
    const dialog = this.dialog;
    const screen = this.observedScreen;
    const send = this.onWidth;
    if (dialog?.kind !== "custom" || screen === undefined || send === undefined) return;
    const columns = screenColumns(screen.querySelector(".screen-line") ?? screen);
    const lastAsked = this.askedWidth?.dialogId === dialog.dialogId ? this.askedWidth.width : undefined;
    if (columns === undefined || !asksForWidth(reason, columns, dialog.screenWidth, lastAsked)) return;
    this.askedWidth = { dialogId: dialog.dialogId, width: columns };
    void Promise.resolve(send(dialog.dialogId, columns)).catch(() => undefined);
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("dialog")) return;
    // Identity is keyed by dialogId, not object identity: status refreshes
    // re-project the same open dialog as a new object and must not wipe a
    // half-typed answer or an in-flight close.
    const identity = this.currentIdentity();
    if (identity !== this.dialogIdentity) {
      this.dialogIdentity = identity;
      this.inputValue = this.openingText();
      this.screenTyped = this.dialog?.kind === "custom" ? this.inputValue : "";
      this.closing = false;
    }
    this.syncCountdownTimer();
  }

  override render(): TemplateResult | null {
    if (this.dialog?.screen !== undefined) return this.renderCard(this.dialog, this.dialog.screen);
    if (this.dialog !== undefined) return this.renderOpen(this.dialog);
    return null;
  }

  /**
   * A screen the extension declared as an interactive card is drawn as that card, not a
   * terminal frame: the daemon never mounted the component, so this is the only place the
   * dialog appears.
   */
  private renderCard(dialog: PendingExtensionDialog, screen: ExtensionDialogScreen): TemplateResult {
    return html`<interactive-card
      .open=${{ dialogId: dialog.dialogId, card: screen }}
      .heading=${splitDialogTitle(dialog.title).heading}
      .draftSessionId=${this.draftSessionId}
      .onSubmit=${(submission: CardSubmission) => this.closeWith(dialog, () => this.onAnswer?.(dialog.dialogId, submission))}
      .onCancel=${() => this.closeWith(dialog, () => this.onCancel?.(dialog.dialogId))}
    ></interactive-card>`;
  }

  private renderOpen(dialog: PendingExtensionDialog): TemplateResult {
    const countdown = extensionDialogCountdownText(dialog.timeoutAt, this.countdownNow === 0 ? Date.now() : this.countdownNow);
    const shape = dialog.kind === "custom" ? classifyScreen(dialog.lines ?? []) : undefined;
    const { heading, body } = splitDialogTitle(screenHeading(shape) ?? dialog.title);
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
        ${this.renderOpenBody(dialog, shape)}
      </article>
    `;
  }

  private renderOpenBody(dialog: PendingExtensionDialog, shape: ScreenShape | undefined): TemplateResult {
    if (shape?.kind === "menu") return this.renderScreenMenu(dialog, shape);
    if (shape !== undefined) return this.renderScreenText(dialog, shape);
    if (dialog.kind === "select") return this.renderSelectBody(dialog);
    if (dialog.kind === "input") return this.renderInputBody(dialog);
    if (dialog.kind === "editor") return this.renderEditorBody(dialog);
    return this.renderConfirmBody(dialog);
  }

  /**
   * An extension's terminal screen that reads as a menu, drawn as a native
   * choice card (state-diagram D2, slice a). The owner met these as a terminal
   * dump headed "Extension screen", with a key row and a mono frame, and a
   * native card queued behind them. The component's first line heads the card;
   * its options are radio choices starting on its own cursor, and Confirm walks
   * that cursor to the chosen option and presses Enter. The owner chose radio
   * choices with Confirm as the default for an undeclared menu (2026-10-02); an
   * extension that wants another look declares its screen.
   */
  private renderScreenMenu(dialog: PendingExtensionDialog, shape: Extract<ScreenShape, { kind: "menu" }>): TemplateResult {
    const chosen = this.chosenScreenLine(dialog, shape);
    return html`
      ${shape.body.length === 0 ? null : html`<p class="dialog-message">${shape.body.join("\n")}</p>`}
      <div class="dialog-options" role="radiogroup" aria-label="Choices">
        ${shape.options.map((option) => html`<label class=${`screen-choice${option.line === chosen ? " chosen" : ""}`}>
          <input
            type="radio"
            name=${`screen-${dialog.dialogId}`}
            .checked=${option.line === chosen}
            ?disabled=${this.closing}
            @change=${() => { this.screenChoice = { dialogId: dialog.dialogId, line: option.line }; }}
          />
          <span>${option.label}</span>
        </label>`)}
      </div>
      <footer class="dialog-footer">
        <button class="secondary-action" type="button" ?disabled=${this.closing} @click=${() => { this.cancelDialog(dialog); }}>Cancel</button>
        <button class="primary-action" type="button" ?disabled=${this.closing || chosen === undefined} @click=${() => { if (chosen !== undefined) void this.tapLine(dialog, chosen).catch(() => undefined); }}>Confirm</button>
      </footer>
    `;
  }

  /** The reader's choice on this dialog's menu while it is still one of its options, else the component's own cursor. */
  private chosenScreenLine(dialog: PendingExtensionDialog, shape: Extract<ScreenShape, { kind: "menu" }>): number | undefined {
    const choice = this.screenChoice;
    if (choice?.dialogId === dialog.dialogId && shape.options.some((option) => option.line === choice.line)) return choice.line;
    return shape.options.find((option) => option.current)?.line ?? shape.options[0]?.line;
  }

  /**
   * The last resort: a terminal screen that does not read as a menu. When the daemon sends styledLines it
   * draws as a web card (styled runs in app tokens, frame and key-hint rows hidden, the selected row marked); otherwise its lines go out as drawn; a tap on a line walks the component's cursor there and selects it, and text goes
   * in through a real field, because a phone raises no keyboard for drawn lines and an input
   * method composes only into a field (the owner's Chinese answer reached a screen as "3").
   * Send types the field into the component and presses Enter; empty, it only presses Enter.
   * There are no arrow keys (owner, 2026-10-11: "pi web 不要上下左右"). On a desktop the
   * keyboard still reaches the component while the screen has focus. Scrollable and
   * focusable, because a screen can be taller than the card.
   */
  private renderScreenText(dialog: PendingExtensionDialog, shape: ScreenShape): TemplateResult {
    const lines = dialog.lines ?? [];
    const styled = dialog.styledLines;
    return html`
      <div
        class=${styled === undefined ? "dialog-screen" : "dialog-screen styled"}
        role="group"
        aria-label="Extension screen"
        tabindex="0"
        @keydown=${(event: KeyboardEvent) => { this.forwardScreenKey(event, dialog); }}
      >${styled === undefined
        ? shape.body.map((line, index) => html`<div
          class=${`screen-line${screenIsTappable(lines) && isSelectableLine(line) ? " selectable" : ""}`}
          @click=${() => { void this.tapLine(dialog, index).catch(() => undefined); }}
        >${line === "" ? " " : line}</div>`)
        : this.renderStyledScreen(dialog, styled)}</div>
      <form class="dialog-input-form" @submit=${(event: SubmitEvent) => { this.pressScreenEnter(event, dialog); }}>
        <input
          class="dialog-input"
          type="text"
          name="screen-text"
          aria-label="Text for the screen"
          placeholder="Type to the screen"
          maxlength=${String(EXTENSION_DIALOG_INPUT_MAX_LENGTH)}
          .value=${live(this.inputValue)}
          ?disabled=${this.closing}
          @input=${(event: Event) => { this.typeIntoScreen(event, dialog); }}
          @compositionend=${(event: Event) => { this.changeInput(event); this.syncScreenText(dialog); }}
          @keydown=${(event: KeyboardEvent) => { this.backspaceIntoScreen(event, dialog); }}
        />
        <footer class="dialog-footer">
          <button class="secondary-action" type="button" ?disabled=${this.closing} @click=${() => { this.cancelDialog(dialog); }}>Cancel</button>
          <button class="primary-action" type="submit" ?disabled=${this.closing}>Send</button>
        </footer>
      </form>
    `;
  }

  /**
   * The field types into the component as the reader types, the way a terminal delivers typing:
   * what was added goes as its characters and what was deleted as Backspace, in order, so a list
   * that searches as you type follows the field (owner, 2026-10-11: "好难操作啊" on
   * an extension's search picker, which took the whole field only at Send). An input method's
   * composition goes when it ends.
   */
  private typeIntoScreen(event: Event, dialog: PendingExtensionDialog): void {
    this.changeInput(event);
    if (Reflect.get(event, "isComposing") === true) return;
    this.syncScreenText(dialog);
  }

  private syncScreenText(dialog: PendingExtensionDialog): void {
    const before = Array.from(this.screenTyped);
    const after = Array.from(this.inputValue);
    let kept = 0;
    while (kept < before.length && kept < after.length && before[kept] === after[kept]) kept += 1;
    this.screenTyped = this.inputValue;
    this.sendScreenKeys(dialog, [...Array.from({ length: before.length - kept }, () => "backspace"), ...after.slice(kept)]);
  }

  /** Backspace in an empty field still reaches the component: what it holds may have been typed before this page loaded. */
  private backspaceIntoScreen(event: KeyboardEvent, dialog: PendingExtensionDialog): void {
    if (event.key !== "Backspace" || keyBelongsToInputMethod(event) || this.inputValue !== "") return;
    this.sendScreenKeys(dialog, ["backspace"]);
  }

  /** Send presses Enter: the text is in the component already. The field starts over for what comes next. */
  private pressScreenEnter(event: SubmitEvent, dialog: PendingExtensionDialog): void {
    event.preventDefault();
    this.syncScreenText(dialog);
    this.sendScreenKeys(dialog, ["enter"]);
    this.inputValue = "";
    this.screenTyped = "";
    if (this.draftSessionId !== "") clearDialogAnswerDraft(this.draftSessionId, dialog.dialogId);
  }

  private sendScreenKeys(dialog: PendingExtensionDialog, keys: readonly string[]): void {
    const send = this.onKey;
    if (keys.length === 0 || send === undefined) return;
    this.screenKeys = this.screenKeys
      .then(async () => {
        for (const key of keys) await send(dialog.dialogId, key);
        this.askForWidth("used");
      })
      .catch(() => undefined);
  }

  /**
   * The screen as the extension styled it (state-diagram D2, 2026-10-11): its roles in the card's
   * own colors, its box drawing and key-hint row left out, the line under its cursor marked as the
   * selected row. Every remaining selectable line can be tapped once the screen shows a cursor.
   */
  private renderStyledScreen(dialog: PendingExtensionDialog, styled: readonly ScreenLine[]): TemplateResult[] {
    const lines = dialog.lines ?? [];
    const tappable = dialog.selectedLine !== undefined;
    return styled.flatMap((line, index) => {
      const text = line.spans.map((span) => span.text).join("");
      if (line.frame === true || (index !== dialog.selectedLine && isScreenHintLine(text))) return [];
      const selectable = tappable && lines[index] !== undefined && isSelectableLine(text);
      return [html`<div
        class=${`screen-line${selectable ? " selectable" : ""}${index === dialog.selectedLine ? " selected" : ""}`}
        @click=${() => { if (selectable) void this.tapLine(dialog, index).catch(() => undefined); }}
      >${line.spans.length === 0 ? " " : line.spans.map((span) => html`<span class=${screenSpanClass(span)}>${span.text}</span>`)}</div>`];
    });
  }

  /**
   * A tap on a line selects it. A daemon that sends styled lines walks the component's cursor there
   * itself, judging every step on the redraw, so an item drawn on two lines or a scrolling list lands
   * where the reader tapped; an older one gets the keys a line count gives.
   */
  private async tapLine(dialog: PendingExtensionDialog, index: number): Promise<void> {
    const lines = dialog.lines ?? [];
    const text = lines[index];
    if (text === undefined || !isSelectableLine(text)) return;
    if (dialog.styledLines !== undefined && this.onLine !== undefined) {
      await this.onLine(dialog.dialogId, index, text);
      this.askForWidth("used");
      return;
    }
    if (!screenIsTappable(lines)) return;
    for (const key of keysForLineTap(lines, index)) await this.onKey?.(dialog.dialogId, key);
    this.askForWidth("used");
  }

  private forwardScreenKey(event: KeyboardEvent, dialog: PendingExtensionDialog): void {
    if (keyBelongsToInputMethod(event)) return;
    const key = dialogScreenKey(event);
    if (key === undefined) return;
    event.preventDefault();
    void Promise.resolve(this.onKey?.(dialog.dialogId, key)).then(() => { this.askForWidth("used"); }, () => undefined);
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

  /**
   * Every option the extension offered, as it offered it (owner, 2026-10-04: show everything, as
   * pi's terminal does): any number, repeated ones as they are, a blank one named so it can be
   * tapped. With none there is nothing to choose, and the card says so beside its Cancel.
   */
  private renderSelectBody(dialog: PendingExtensionDialog): TemplateResult {
    const options = dialog.options ?? [];
    return html`
      ${options.length === 0 ? html`<p class="dialog-message">${NO_CHOICES_TEXT}</p>` : html`<div class="dialog-options" role="group" aria-label="Choices">
        ${options.map((option) => html`
          <button class="option-button" type="button" ?disabled=${this.closing} @click=${() => { this.answerDialog(dialog, option); }}>${option === "" ? BLANK_OPTION_LABEL : option}</button>
        `)}
      </div>`}
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

  /**
   * pi's `ctx.ui.editor(title, prefill)`: a multi-line text the reader edits and sends back. Enter
   * follows the composer's rule, as pi's editor follows its main editor's (Enter sends on a
   * keyboard, a new line on a touch screen, the reader's Enter setting either way); while an input
   * method is composing, Enter picks the word.
   */
  private renderEditorBody(dialog: PendingExtensionDialog): TemplateResult {
    return html`
      <form class="dialog-input-form dialog-editor-form" @submit=${(event: SubmitEvent) => { this.submitInput(event, dialog); }}>
        ${dialog.prefillCut === undefined ? null : html`<p class="dialog-editor-cut">${editorCutText(dialog.prefillCut)}</p>`}
        <textarea
          class="dialog-input dialog-editor"
          name="dialog-answer"
          aria-label="Your text"
          maxlength=${String(EXTENSION_DIALOG_EDITOR_MAX_LENGTH)}
          .value=${this.inputValue}
          ?disabled=${this.closing}
          @input=${(event: Event) => { this.changeInput(event); }}
          @keydown=${(event: KeyboardEvent) => { this.editorKeydown(event, dialog); }}
          @keyup=${(event: KeyboardEvent) => { if (event.key === "Shift") this.explicitShiftKeyActive = false; }}
          @blur=${() => { this.explicitShiftKeyActive = false; }}
        ></textarea>
        <footer class="dialog-footer">
          <button class="secondary-action" type="button" ?disabled=${this.closing} @click=${() => { this.cancelDialog(dialog); }}>Cancel</button>
          <button class="primary-action" type="submit" ?disabled=${this.closing}>${this.closing ? "Sending…" : "Send"}</button>
        </footer>
      </form>
    `;
  }

  private editorKeydown(event: KeyboardEvent, dialog: PendingExtensionDialog): void {
    if (event.key === "Shift") {
      this.explicitShiftKeyActive = true;
      return;
    }
    if (event.key !== "Enter") {
      this.explicitShiftKeyActive = false;
      return;
    }
    if (keyBelongsToInputMethod(event)) return;
    const shiftKey = shouldUsePromptEnterShiftShortcut(event.shiftKey, this.explicitShiftKeyActive);
    this.explicitShiftKeyActive = false;
    if (!shouldSendPromptOnEnterShortcut(shiftKey)) return;
    event.preventDefault();
    this.answerDialog(dialog, this.inputValue);
  }

  private answerDialog(dialog: PendingExtensionDialog, value: ExtensionDialogAnswer): void {
    void this.closeWith(dialog, () => this.onAnswer?.(dialog.dialogId, value));
  }

  private cancelDialog(dialog: PendingExtensionDialog): void {
    void this.closeWith(dialog, () => this.onCancel?.(dialog.dialogId));
  }

  private submitInput(event: SubmitEvent, dialog: PendingExtensionDialog): void {
    event.preventDefault();
    // An empty string is a valid input answer, so Send stays enabled.
    this.answerDialog(dialog, this.inputValue);
  }

  /** Settles when the close request does, so a caller can show it is in flight. */
  private closeWith(dialog: PendingExtensionDialog, close: () => void | Promise<void>): Promise<void> {
    if (this.closing) return Promise.resolve();
    this.closing = true;
    const dialogId = dialog.dialogId;
    return Promise.resolve()
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
    if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement)) return;
    this.inputValue = input.value;
    if (this.dialog !== undefined && this.draftSessionId !== "") saveDialogAnswerDraft(this.draftSessionId, this.dialog.dialogId, input.value);
  }

  /** An open input, editor or screen dialog shows what this browser kept of its typed text (dialogAnswerDrafts), else its opening text. */
  private openingText(): string {
    const dialog = this.dialog;
    if (dialog === undefined || (dialog.kind !== "input" && dialog.kind !== "editor" && dialog.kind !== "custom")) return "";
    const kept = this.draftSessionId === "" ? undefined : loadDialogAnswerDraft(this.draftSessionId, dialog.dialogId);
    return kept ?? (dialog.kind === "editor" ? dialog.prefill ?? "" : "");
  }

  private currentIdentity(): string | undefined {
    if (this.dialog !== undefined) return `open:${this.dialog.dialogId}`;
    return undefined;
  }

  private syncCountdownTimer(): void {
    const needsTick = this.isConnected && this.dialog?.timeoutAt !== undefined;
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

  static override styles = [css`
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
    /* The editor's text area is the card's one scroller, as the detail is for prose: the slot's
       height budget lands on it and the actions stay on screen. */
    .dialog-editor-form { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
    .dialog-input.dialog-editor { flex: 1 1 auto; min-height: calc(6lh + 2 * var(--pi-space-4)); resize: vertical; white-space: pre-wrap; overflow-wrap: anywhere; }
    .dialog-editor-cut { margin: var(--pi-space-6) var(--pi-space-7) 0; color: var(--pi-warning); font-size: var(--pi-text-xs); }
    /* A terminal the reader can recognise: mono, its own darker pane, room for a
     tall menu, and a hint above it saying who is asking and where keys go. */
  .dialog-screen { box-sizing: border-box; margin: 0; padding: var(--pi-space-4) var(--pi-space-5); max-height: 46vh; overflow: auto; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-bg); color: var(--pi-text); font-family: var(--pi-font-mono); font-size: var(--pi-text-xs); line-height: 1.5; tab-size: 2; }
  /* One row per line, so a line can be tapped: monospace + pre keeps the columns
     the component drew. */
  .screen-line { white-space: pre; }
  .screen-line.selectable { border-radius: var(--pi-radius-sm); cursor: pointer; }
  .screen-line.selectable:active { background: var(--pi-surface-hover); }
  /* A declared screen renders as a card, not a terminal: proportional text for the
     option rows (a real control with the touch floor), and the component's own text
     kept pre-formatted, because it may be a column-aligned list. */
  .screen-choice { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: var(--pi-space-4); box-sizing: border-box; min-height: var(--pi-control-height-touch); padding: var(--pi-space-4); border: 1px solid transparent; border-radius: var(--pi-radius-md); line-height: 1.35; overflow-wrap: anywhere; cursor: pointer; }
  .screen-choice.chosen { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
  .screen-choice input { width: var(--pi-checkbox-size); height: var(--pi-checkbox-size); margin: 0; accent-color: var(--pi-accent); }
  .dialog-screen.styled { padding: var(--pi-space-2) 0; border: none; background: transparent; font-family: inherit; font-size: var(--pi-text-sm); line-height: 1.45; }
  .dialog-screen.styled .screen-line { padding: 1px var(--pi-space-3); white-space: pre-wrap; overflow-wrap: anywhere; border-radius: var(--pi-radius-sm); }
  .dialog-screen.styled .screen-line.selected { background: var(--pi-selection-bg); }
  .fg-accent, .fg-borderAccent, .fg-mdHeading, .fg-mdLink, .fg-toolTitle, .fg-customMessageLabel { color: var(--pi-accent); }
  .fg-dim, .fg-muted, .fg-border, .fg-borderMuted, .fg-thinkingText, .fg-mdCodeBlockBorder, .fg-mdQuoteBorder, .fg-mdHr, .fg-toolDiffContext, .fg-syntaxComment { color: var(--pi-muted); }
  .fg-success, .fg-toolDiffAdded { color: var(--pi-success); }
  .fg-error, .fg-toolDiffRemoved { color: var(--pi-danger); }
  .fg-warning { color: var(--pi-warning); }
  .bg-selectedBg, .bg-searchMatchBg { background: var(--pi-selection-bg); }
  .bold { font-weight: var(--pi-weight-semibold); }
  .dim { opacity: 0.72; }
  .italic { font-style: italic; }
  .underline { text-decoration: underline; }
  .strike { text-decoration: line-through; }
  .inverse { background: var(--pi-text); color: var(--pi-surface); }
  .dialog-screen:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset); }
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
         pointer type: the owner's decision is "phone and desktop both go back to the document flow; desktop doesn't float either"
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
    /* A control a person taps is a touch target wherever the card is shown, as
       the ask-user card beside it in the same transcript already states. */
    .primary-action, .secondary-action, .option-button, .dialog-input { min-height: var(--pi-control-height-touch); }
    @container (max-width: 580px) {
      /* A cap alone contains nothing: overflow is visible by default, so the
         text kept painting past the bottom of its box and straight through the
         option buttons below it. A goal draft showed its wording between and
         behind the answers. A height limit has to say what happens to what
         does not fit. */
      .dialog-detail { max-height: min(40vh, 320px); overflow-y: auto; overscroll-behavior-x: contain; }
    }
  `];
}

declare global {
  interface HTMLElementTagNameMap {
    "extension-dialog-card": ExtensionDialogCard;
  }
}
