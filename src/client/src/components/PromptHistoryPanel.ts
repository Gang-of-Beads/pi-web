import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { searchPromptHistory } from "../promptHistory";
import { switcherInitialFocus, touchPrimaryPointer } from "../keyboardDismissal";
import { keyboardEventOriginatesFromNativeActivationControl } from "./keyboardEventTarget";
import { scrollWhenSelected } from "./scrollWhenSelected";
import "./ModalSurface";

/**
 * The composer's prompt history as a closable, searchable sheet.
 *
 * The surface this replaces was an autocomplete-style strip above the editor:
 * no search - and search was the original request - no close affordance that
 * worked by touch, and it covered the composer it feeds. This sheet anchors
 * itself above the composer instead of over it, ranks entries with the same
 * `searchPromptHistory` the Ctrl/Cmd+R shortcut always used, and closes three
 * ways: the close button, a backdrop tap, and Escape (owned by ModalSurface).
 *
 * It lives inside prompt-editor's shadow root and anchors to its top edge, so
 * the layer's height reaches over the transcript without ever covering the
 * composer or its action row.
 */
@customElement("prompt-history-panel")
export class PromptHistoryPanel extends LitElement {
  /** `machineSessionKey` of the session whose prompt history is listed. */
  @property() sessionKey = "";
  /** The session's own user prompts, most recent first. */
  @property({ attribute: false }) sessionPrompts: string[] = [];
  /** Called with the tapped entry's text; the host fills the composer. */
  @property({ attribute: false }) onPick?: (text: string) => void;
  @property({ attribute: false }) onClose?: () => void;

  @state() private query = "";
  @state() private selectedIndex = 0;

  private entries(): string[] {
    return searchPromptHistory(this.sessionKey, this.query, this.sessionPrompts);
  }

  override render() {
    const entries = this.entries();
    const selected = Math.min(this.selectedIndex, Math.max(entries.length - 1, 0));
    return html`
      <modal-surface
        .onClose=${() => { this.onClose?.(); }}
        .initialFocus=${switcherInitialFocus({ touchPrimary: touchPrimaryPointer() })}
        .label=${"Prompt history"}
        @keydown=${(event: KeyboardEvent) => { this.handleKeyDown(event, entries, selected); }}
      >
        <header>
          <input
            class="history-search"
            type="search"
            inputmode="search"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            enterkeyhint="search"
            aria-label="Search prompt history"
            placeholder="Search prompts"
            .value=${this.query}
            @input=${(event: Event) => { this.onQueryInput(event); }}
          >
          <button class="close" type="button" title="Close" aria-label="Close prompt history" @click=${() => { this.onClose?.(); }}>×</button>
        </header>
        <div class="body">
          ${entries.length === 0
            ? html`<p class="empty">${this.query.trim() === "" ? "No prompts yet." : `No prompts match “${this.query.trim()}”.`}</p>`
            : entries.map((entry, index) => html`
              <button
                type="button"
                class=${`entry${index === selected ? " selected" : ""}`}
                title=${entry}
                dir="auto"
                ${scrollWhenSelected(index === selected, entry)}
                @click=${() => { this.pick(entry); }}
              ><span class="entry-text">${entry}</span></button>
            `)}
        </div>
      </modal-surface>
    `;
  }

  private onQueryInput(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    this.query = event.target.value;
    // A new query resets the walk, so Enter always reuses what the eye sees first.
    this.selectedIndex = 0;
  }

  private handleKeyDown(event: KeyboardEvent, entries: readonly string[], selected: number): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (entries.length === 0) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      this.selectedIndex = Math.min(Math.max(selected + step, 0), entries.length - 1);
      return;
    }
    if (event.key !== "Enter" || keyboardEventOriginatesFromNativeActivationControl(event)) return;
    const entry = entries[selected];
    if (entry === undefined) return;
    event.preventDefault();
    this.pick(entry);
  }

  private pick(entry: string): void {
    this.onPick?.(entry);
  }

  static override styles = css`
    /* The sheet's controls are in their own shadow root, so the composer's
       tap rules do not reach them: without these, every row and the close
       button stay eligible for the browser's double-tap-zoom click delay. */
    button, input { font: var(--pi-text-xs) var(--pi-font-ui); -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
    :host { position: absolute; left: 0; right: 0; bottom: 100%; height: 100dvh; z-index: 6; color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui); }
    modal-surface {
      --modal-surface-place-items: end center;
      --modal-surface-width: min(560px, 100%);
      --modal-surface-max-height: min(60dvh, 480px);
    }
    header { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--pi-space-4); align-items: center; padding: var(--pi-space-5); border-bottom: 1px solid var(--pi-border); }
    .history-search { box-sizing: border-box; min-width: 0; height: 44px; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-bg); color: var(--pi-text); padding: 0 var(--pi-space-5); /* 16px keeps iOS from zooming the field on focus. */ font: var(--pi-control-font-size, 16px) var(--pi-control-font-family, system-ui, sans-serif); }
    .history-search::placeholder { color: var(--pi-dim); }
    .history-search::-webkit-search-cancel-button { display: none; }
    .history-search:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: 1px; }
    .close { display: inline-grid; place-items: center; width: 44px; height: 44px; box-sizing: border-box; padding: 0; border: 0; border-radius: var(--pi-radius-md); background: transparent; color: var(--pi-muted); font-size: var(--pi-text-xl); line-height: 1; cursor: pointer; }
    .close:focus-visible { color: var(--pi-text-bright); border-color: var(--pi-accent); }
    @media (hover: hover) { .close:hover { color: var(--pi-text-bright); border-color: var(--pi-accent); } }
    .body { flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; }
    .entry { display: block; box-sizing: border-box; width: 100%; min-height: 44px; border: 0; border-bottom: 1px solid var(--pi-border); border-radius: 0; background: transparent; color: var(--pi-text); padding: var(--pi-space-4) var(--pi-space-5); text-align: left; cursor: pointer; }
    .entry:last-child { border-bottom: 0; }
    .entry.selected { background: var(--pi-selection-bg); }
    @media (hover: hover) { .entry:hover { background: var(--pi-selection-bg); } }
    .entry:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: -2px; }
    .entry-text { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; overflow-wrap: anywhere; font: var(--pi-text-sm) var(--pi-font-ui); line-height: 1.4; }
    .empty { margin: var(--pi-space-7) var(--pi-space-2); color: var(--pi-muted); text-align: center; }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "prompt-history-panel": PromptHistoryPanel;
  }
}
