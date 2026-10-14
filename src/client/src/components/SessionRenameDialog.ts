import { LitElement, css, html, type PropertyValues, type TemplateResult, unsafeCSS } from "lit";
import { barKeyStyles } from "./appShell/panelHeaderStyles";
import { renderCrossIcon, uiIconStyle } from "./uiIcons.js";
import { customElement, property, query, state } from "lit/decorators.js";
import "./ModalSurface";
import { interactiveSurfaceStyles } from "./shared";

/** What is being renamed, and the words the dialog uses for it. */
export type RenameSubject = "session" | "machine";

const RENAME_WORDS: Readonly<Record<RenameSubject, { readonly title: string; readonly field: string; readonly hint: string }>> = {
  session: { title: "Rename session", field: "Session name", hint: "A name only you see. Empty or unchanged keeps the current one." },
  machine: { title: "Rename machine", field: "Machine name", hint: "The name this PI WEB shows for the machine. Empty or unchanged keeps the current one." },
};

/**
 * Rename a session, or a machine in the list, in the project's own dialog.
 *
 * The native `prompt()` this replaces is suppressed in iOS standalone mode,
 * ignores the theme, and blocks rendering. The contract it carried is kept:
 * an unchanged or empty answer renames nothing, so neither can clear an
 * existing name by accident - but that contract is visible here as a disabled
 * send rather than a silent drop.
 */
@customElement("session-rename-dialog")
export class SessionRenameDialog extends LitElement {
  @property({ attribute: false }) currentName = "";
  @property({ attribute: false }) subject: RenameSubject = "session";
  @property({ attribute: false }) onSubmit?: (name: string) => void | Promise<void>;
  @property({ attribute: false }) onCancel?: () => void;

  @state() private draft = "";
  @state() private submitting = false;
  @query("input") private nameInput?: HTMLInputElement;

  static override styles = [css`${unsafeCSS(uiIconStyle)}`, interactiveSurfaceStyles, css`
    :host { position: fixed; inset: 0; z-index: var(--pi-layer-dialog); color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui); line-height: inherit; }
    modal-surface { --modal-surface-place-items: start center; --modal-surface-backdrop-padding: min(12vh, 90px) 0 0; --modal-surface-width: min(560px, calc(100vw - 40px)); --modal-surface-max-height: min(640px, calc(100vh - 40px)); }
    form { display: flex; flex-direction: column; min-height: 0; }
    header, footer { display: flex; align-items: center; justify-content: space-between; gap: var(--pi-space-4); padding: var(--pi-space-6); border-bottom: 1px solid var(--pi-border); }
    footer { border-bottom: none; border-top: 1px solid var(--pi-border); }
    .body { display: flex; flex-direction: column; gap: var(--pi-space-4); padding: var(--pi-space-6); overflow: auto; }
    label { display: flex; flex-direction: column; gap: var(--pi-space-2); font-size: var(--pi-text-sm); color: var(--pi-muted); }
    input { box-sizing: border-box; min-height: var(--pi-control-height-comfort); font: var(--pi-control-font-size, 16px) var(--pi-font-ui); line-height: inherit; color: var(--pi-text); background: var(--pi-bg); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); padding: var(--pi-space-4) var(--pi-space-5); }
    input:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-tight); }
    .hint { color: var(--pi-muted); font-size: var(--pi-text-xs); margin: 0; }
    button { font: inherit; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-4) var(--pi-space-5); cursor: pointer; }
    .primary { border-color: var(--pi-accent); background: var(--pi-accent); color: var(--pi-on-accent, var(--pi-bg)); font-weight: var(--pi-weight-semibold); }
    button:disabled { opacity: var(--pi-disabled-opacity); cursor: not-allowed; }
    footer { justify-content: flex-end; gap: var(--pi-space-4); }
    @media (pointer: coarse) { footer button { min-height: var(--pi-control-height-touch, 44px); } input { min-height: var(--pi-control-height-touch, 44px); } }
  `, barKeyStyles];

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("currentName")) this.draft = this.currentName;
  }

  protected override firstUpdated(): void {
    this.nameInput?.select();
  }

  private handleInput(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    this.draft = event.target.value;
  }

  private handleSubmit(event: SubmitEvent): void {
    event.preventDefault();
    void this.submit();
  }

  private async submit(): Promise<void> {
    const next = this.draft.trim();
    if (next === "" || next === this.currentName || this.submitting) return;
    this.submitting = true;
    try {
      await this.onSubmit?.(next);
    } finally {
      if (this.isConnected) this.submitting = false;
    }
  }

  override render(): TemplateResult {
    const trimmed = this.draft.trim();
    const canSubmit = trimmed !== "" && trimmed !== this.currentName && !this.submitting;
    const words = RENAME_WORDS[this.subject];
    return html`
      <modal-surface
        .onClose=${() => this.onCancel?.()}
        .initialFocus=${"input"}
        .label=${words.title}
      >
        <form @submit=${(event: SubmitEvent) => { this.handleSubmit(event); }}>
          <header>
            <strong>${words.title}</strong>
            <button type="button" class="bar-key" @click=${() => { this.onCancel?.(); }} aria-label="Close">${renderCrossIcon()}</button>
          </header>
          <div class="body">
            <label>
              ${words.field}
              <input type="text" .value=${this.draft} @input=${(event: Event) => { this.handleInput(event); }} maxlength="200" autocomplete="off" />
            </label>
            <p class="hint">${words.hint}</p>
          </div>
          <footer>
            <button type="button" @click=${() => { this.onCancel?.(); }}>Cancel</button>
            <button class="primary" type="submit" ?disabled=${!canSubmit}>${this.submitting ? "Renaming…" : "Rename"}</button>
          </footer>
        </form>
      </modal-surface>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "session-rename-dialog": SessionRenameDialog;
  }
}
