import { LitElement, css, html } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import { interactiveSurfaceStyles } from "./shared";

export type ConfirmTone = "danger" | "default";

/**
 * The body of the app's own confirmation (B40), presented on the shared dialog surface.
 *
 * It replaces `window.confirm`, which on a phone drew the browser's sheet with the page's
 * address as its title and never named what was about to be deleted. The card names the thing,
 * says what happens, and puts Cancel first so the destructive key is never the default under a
 * thumb; Escape, the backdrop and the back gesture all mean Cancel.
 */
@customElement("pi-confirm-card")
export class ConfirmCard extends LitElement {
  @property({ attribute: false }) heading = "";
  @property({ attribute: false }) message = "";
  @property({ attribute: false }) confirmLabel = "";
  @property({ attribute: false }) tone: ConfirmTone = "default";
  @property({ attribute: false }) onAnswer?: (confirmed: boolean) => void;
  @query(".cancel") private cancelButton?: HTMLButtonElement;

  static override styles = [interactiveSurfaceStyles, css`
    :host { display: flex; flex-direction: column; min-height: 0; color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui); }
    h2 { margin: 0; padding: var(--pi-space-6) var(--pi-space-6) 0; font-size: var(--pi-text-lg); font-weight: var(--pi-weight-semibold); overflow-wrap: anywhere; }
    p { margin: 0; padding: var(--pi-space-4) var(--pi-space-6) var(--pi-space-6); color: var(--pi-muted); white-space: pre-line; overflow-wrap: anywhere; }
    footer { display: flex; justify-content: flex-end; gap: var(--pi-space-4); padding: var(--pi-space-5) var(--pi-space-6); border-top: 1px solid var(--pi-border); }
    button { box-sizing: border-box; min-height: var(--pi-control-height-comfort); font: inherit; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-4) var(--pi-space-6); cursor: pointer; }
    button:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-tight); }
    .confirm { border-color: var(--pi-accent); background: var(--pi-accent); color: var(--pi-on-accent, var(--pi-bg)); font-weight: var(--pi-weight-semibold); }
    .confirm.danger { border-color: var(--pi-danger); background: color-mix(in srgb, var(--pi-danger) 14%, var(--pi-surface)); color: var(--pi-danger); }
  `];

  override firstUpdated(): void {
    this.cancelButton?.focus();
  }

  override render() {
    return html`
      <h2>${this.heading}</h2>
      ${this.message === "" ? null : html`<p>${this.message}</p>`}
      <footer>
        <button type="button" class="cancel" @click=${() => { this.onAnswer?.(false); }}>Cancel</button>
        <button type="button" class=${this.tone === "danger" ? "confirm danger" : "confirm"} @click=${() => { this.onAnswer?.(true); }}>${this.confirmLabel}</button>
      </footer>
    `;
  }
}
