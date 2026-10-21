import { LitElement, css, html, unsafeCSS } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { commandLayout, type CommandWord } from "../commandLayout";
import { interactiveSurfaceStyles } from "./shared";
import { renderCheckIcon, renderCopyIcon, renderCrossIcon, uiIconStyle } from "./uiIcons";

/** What the copy key last said; a clipboard that refuses says so. */
export type CommandCopyOutcome = "copied" | "refused";

const COPY_SAID: Readonly<Record<CommandCopyOutcome, string>> = {
  copied: "Copied",
  refused: "Could not copy",
};

const COPY_SAID_MS = 2_000;

function renderCommandWord(word: CommandWord) {
  const text = word.pieces.length > 1 ? word.pieces.map((piece) => html`<span class="piece">${piece}</span>`) : word.pieces;
  return html`<span class="word">${text}</span>${word.gapAfter}`;
}

/** The command laid out by `commandLayout`: the same characters, grouped so lines break between words. */
function renderCommand(command: string) {
  const layout = commandLayout(command);
  return html`${layout.lead}${layout.stages.map((stage) => html`<span class="stage">${stage.words.map(renderCommandWord)}</span>${stage.gapAfter}`)}`;
}

/**
 * The body of the dialog for a command a global page could not type into its new shell (owner,
 * 2026-10-21): the reader needs the command itself, and the app row carries no button.
 *
 * It is drawn as the app's other small dialogs are: the alert surface, a header with the title and
 * the bar-sized close key, then one sentence, the command in the command box the Background page
 * draws (mono, the output surface, at most four lines with its own scroll) with the message copy
 * key in its corner, and a footer with Open Terminal as the dialog's one accent action.
 *
 * A long command wraps between its words, continuation lines indented under the command rather than
 * under `$` (see `commandLayout`). A triple-click selects exactly the command: the browser's own
 * paragraph selection runs on to the next selectable text and copies newlines with the command, and
 * a pasted newline runs it. For the same reason the buttons and the status line are not selectable.
 */
@customElement("pi-command-not-run-card")
export class CommandNotRunCard extends LitElement {
  @property({ attribute: false }) heading = "";
  @property({ attribute: false }) sentence = "";
  @property({ attribute: false }) command = "";
  @property({ attribute: false }) copyText?: (text: string) => Promise<boolean>;
  @property({ attribute: false }) onOpenTerminal?: () => void;
  @property({ attribute: false }) onClose?: () => void;
  @state() private said: CommandCopyOutcome | undefined;
  @query(".open") private openButton?: HTMLButtonElement;
  @query(".command-text") private commandText?: HTMLElement;
  private saidTimer: ReturnType<typeof setTimeout> | undefined;

  static override styles = [interactiveSurfaceStyles, css`${unsafeCSS(uiIconStyle)}`, css`
    :host { display: flex; flex-direction: column; min-height: 0; color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui); line-height: 1.4; }
    header { display: flex; align-items: center; justify-content: space-between; gap: var(--pi-space-4); padding: var(--pi-space-4) var(--pi-space-4) var(--pi-space-4) var(--pi-space-6); border-bottom: 1px solid var(--pi-border); }
    h2 { margin: 0; font-size: var(--pi-text-lg); font-weight: var(--pi-weight-semibold); overflow-wrap: anywhere; }
    .body { display: grid; gap: var(--pi-space-4); min-height: 0; padding: var(--pi-space-5) var(--pi-space-6) var(--pi-space-6); overflow-y: auto; overscroll-behavior: contain; }
    .body > p { margin: 0; color: var(--pi-muted); overflow-wrap: anywhere; }
    .command { box-sizing: border-box; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; column-gap: var(--pi-space-3); min-width: 0; padding: var(--pi-space-3); padding-inline-start: var(--pi-space-5); border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-md); background: var(--pi-surface-canvas); color: var(--pi-text-secondary); font: var(--pi-text-xs) var(--pi-font-mono); line-height: 1.45; }
    .command p { margin: 0; padding-block: var(--pi-space-1); padding-inline-start: 2ch; max-height: calc(4 * 1.45em); overflow-y: auto; text-indent: -2ch; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; -webkit-user-select: text; }
    .stage, .word, .piece { display: inline-block; max-width: 100%; vertical-align: top; text-indent: 0; }
    .word, .piece { word-break: break-all; }
    .prompt, .said, button { user-select: none; -webkit-user-select: none; }
    .prompt { color: var(--pi-dim); }
    .copy { --command-copy-size: 22px; position: relative; align-self: start; box-sizing: border-box; display: inline-grid; place-items: center; width: var(--command-copy-size); height: var(--command-copy-size); padding: 0; border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-sm); background: var(--pi-surface); color: var(--pi-muted); line-height: 1; cursor: pointer; }
    .copy .ui-icon { width: 14px; height: 14px; }
    .copy::after { content: ""; position: absolute; inset: calc(-1 * var(--pi-space-5)) calc(-1 * var(--pi-space-1)); }
    .copy[data-said="copied"] { color: var(--pi-text); border-color: var(--pi-accent); }
    .said { grid-column: 1 / -1; justify-self: end; color: var(--pi-muted); font: var(--pi-text-xs) var(--pi-font-ui); }
    .said[data-said="refused"] { color: var(--pi-danger); }
    footer { display: flex; justify-content: flex-end; padding: var(--pi-space-5) var(--pi-space-6) var(--pi-space-6); border-top: 1px solid var(--pi-border); }
    .key, .open { position: relative; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; min-height: var(--pi-control-height-comfort); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); font: var(--pi-text-sm) var(--pi-font-ui); cursor: pointer; }
    .key { flex: 0 0 auto; width: var(--pi-control-height-comfort); padding: 0; }
    .key .ui-icon { width: 18px; height: 18px; }
    .open { padding: 0 var(--pi-space-6); border-color: var(--pi-accent); background: var(--pi-accent); color: var(--pi-on-accent); font-weight: var(--pi-weight-semibold); }
    button:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-tight); }
    @media (hover: hover) { .copy:hover { color: var(--pi-text); border-color: var(--pi-accent); } }
    @media (hover: hover) { .key:hover { background: var(--pi-surface-hover); } }
    @media (pointer: coarse) {
      .copy::after { inset: calc((var(--command-copy-size) - var(--pi-control-height-touch)) / 2 - 1px); inset-inline-start: 0; }
      .copy:active, .key:active { background: var(--pi-surface-hover); }
      .key::after, .open::after { content: ""; position: absolute; inset: calc((var(--pi-control-height-comfort) - var(--pi-control-height-touch)) / 2 - 1px) -1px; }
      .key::after { inset: calc((var(--pi-control-height-comfort) - var(--pi-control-height-touch)) / 2 - 1px); }
    }
  `];

  override firstUpdated(): void {
    this.openButton?.focus();
  }

  override disconnectedCallback(): void {
    clearTimeout(this.saidTimer);
    super.disconnectedCallback();
  }

  private selectCommandOnTripleClick(event: MouseEvent): void {
    if (event.detail < 3 || this.commandText === undefined) return;
    getSelection()?.selectAllChildren(this.commandText);
  }

  private async copy(): Promise<void> {
    const copied = await (this.copyText?.(this.command) ?? Promise.resolve(false)).catch(() => false);
    this.said = copied ? "copied" : "refused";
    clearTimeout(this.saidTimer);
    this.saidTimer = setTimeout(() => { this.said = undefined; }, COPY_SAID_MS);
  }

  override render() {
    const copied = this.said === "copied";
    return html`
      <header>
        <h2>${this.heading}</h2>
        <button type="button" class="key" aria-label="Close" @click=${() => { this.onClose?.(); }}>${renderCrossIcon()}</button>
      </header>
      <div class="body">
        <p>${this.sentence}</p>
        <div class="command">
          <p @click=${(event: MouseEvent) => { this.selectCommandOnTripleClick(event); }}><span class="prompt">$ </span><span class="command-text">${renderCommand(this.command)}</span></p>
          <button type="button" class="copy" data-said=${this.said ?? ""} title=${copied ? "Copied" : "Copy command"} aria-label=${copied ? "Copied" : "Copy command"} @click=${() => { void this.copy(); }}>${copied ? renderCheckIcon() : renderCopyIcon()}</button>
          <span class="said" role="status" data-said=${this.said ?? ""}>${this.said === undefined ? "" : COPY_SAID[this.said]}</span>
        </div>
      </div>
      <footer>
        <button type="button" class="open" @click=${() => { this.onOpenTerminal?.(); }}>Open Terminal</button>
      </footer>
    `;
  }
}
