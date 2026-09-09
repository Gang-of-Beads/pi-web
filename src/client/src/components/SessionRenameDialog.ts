import { LitElement, css, html, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import "./ModalSurface";
import { interactiveSurfaceStyles } from "./shared";

/**
 * Rename a session in the project's own dialog.
 *
 * The native `prompt()` this replaces is suppressed in iOS standalone mode,
 * ignores the theme, and blocks rendering. The contract it carried is kept:
 * an unchanged or empty answer renames nothing, so neither can clear an
 * existing name by accident - but that contract is visible here as a disabled
 * send rather than a silent drop.
 */
@customElement("session-rename-dialog")
export class SessionRenameDialog extends LitElement {
  @property({ attribute: false }) sessionName = "";
  @property({ attribute: false }) onSubmit?: (name: string) => void | Promise<void>;
  @property({ attribute: false }) onCancel?: () => void;

  @state() private draft = "";
  @state() private submitting = false;
  @query("input") private nameInput?: HTMLInputElement;

  static override styles = [interactiveSurfaceStyles, css`
    :host { position: fixed; inset: 0; z-index: var(--pi-layer-dialog); color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui); }
    modal-surface { --modal-surface-place-items: start center; --modal-surface-backdrop-padding: min(12vh, 90px) 0 0; --modal-surface-width: min(560px, calc(100vw - 40px)); --modal-surface-max-height: min(640px, calc(100vh - 40px)); }
    form { display: flex; flex-direction: column; min-height: 0; }
    header, footer { display: flex; align-items: center; justify-content: space-between; gap: var(--pi-space-4); padding: var(--pi-space-6); border-bottom: 1px solid var(--pi-border); }
    footer { border-bottom: none; border-top: 1px solid var(--pi-border); }
    .body { display: flex; flex-direction: column; gap: var(--pi-space-4); padding: var(--pi-space-6); overflow: auto; }
    label { display: flex; flex-direction: column; gap: var(--pi-space-2); font-size: var(--pi-text-sm); color: var(--pi-muted); }
    input { font: inherit; color: var(--pi-text); background: var(--pi-bg); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); padding: var(--pi-space-4) var(--pi-space-5); }
    input:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-tight); }
    .hint { color: var(--pi-muted); font-size: var(--pi-text-xs); margin: 0; }
    button { font: inherit; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-4) var(--pi-space-5); cursor: pointer; }
    header button { display: grid; place-items: center; box-sizing: border-box; width: var(--pi-control-height); height: var(--pi-control-height); padding: 0; line-height: 1; border: 0; background: transparent; color: var(--pi-muted); font-size: var(--pi-text-xl); padding: 0 var(--pi-space-4); }
    .primary { border-color: var(--pi-accent); background: var(--pi-accent); color: var(--pi-on-accent, var(--pi-bg)); font-weight: var(--pi-weight-semibold); }
    button:disabled { opacity: var(--pi-disabled-opacity); cursor: not-allowed; }
    footer { justify-content: flex-end; gap: var(--pi-space-4); }
    @media (pointer: coarse) { footer button, header button { min-height: var(--pi-control-height-touch, 44px); } header button { width: var(--pi-control-height-touch, 44px); } input { min-height: var(--pi-control-height-touch, 44px); } }
  `];

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("sessionName")) this.draft = this.sessionName;
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
    if (next === "" || next === this.sessionName || this.submitting) return;
    this.submitting = true;
    try {
      await this.onSubmit?.(next);
    } finally {
      if (this.isConnected) this.submitting = false;
    }
  }

  override render(): TemplateResult {
    const trimmed = this.draft.trim();
    const canSubmit = trimmed !== "" && trimmed !== this.sessionName && !this.submitting;
    return html`
      <modal-surface
        .onClose=${() => this.onCancel?.()}
        .initialFocus=${"input"}
        .label=${"Rename session"}
      >
        <form @submit=${(event: SubmitEvent) => { this.handleSubmit(event); }}>
          <header>
            <strong>Rename session</strong>
            <button type="button" @click=${() => { this.onCancel?.(); }} aria-label="Close">×</button>
          </header>
          <div class="body">
            <label>
              Session name
              <input type="text" .value=${this.draft} @input=${(event: Event) => { this.handleInput(event); }} maxlength="200" autocomplete="off" />
            </label>
            <p class="hint">A name only you see. Empty or unchanged keeps the current one.</p>
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
