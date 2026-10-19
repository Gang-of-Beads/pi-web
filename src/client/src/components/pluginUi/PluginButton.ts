import { css, html, LitElement, nothing, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { interactiveSurfaceStyles } from "../shared";
import { openingMarkStyles, renderOpeningSpinner } from "../openingMark";
import type { PluginButton } from "../../../../shared/pluginApiTypes";

const IDLE_BUTTON: PluginButton = { label: "", run: () => undefined };

/**
 * A plugin's button, drawn the way the host's status lists draw theirs. Busy keeps the label and
 * puts the spinner in the start padding, so a press never makes the button change width under the
 * finger; the padding is wide enough to hold it at every state.
 */
export class PluginButtonElement extends LitElement {
  @property({ attribute: false }) button: PluginButton = IDLE_BUTTON;

  static override styles = [interactiveSurfaceStyles, openingMarkStyles, css`
    :host { display: inline-flex; max-width: 100%; }
    button { position: relative; box-sizing: border-box; max-width: 100%; min-height: var(--pi-control-height-comfort); display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface-raised); color: var(--pi-text); padding: 0 var(--pi-space-7); font: var(--pi-text-sm) var(--pi-font-ui); overflow-wrap: anywhere; cursor: pointer; }
    button.primary { border-color: var(--pi-accent-border); color: var(--pi-accent); }
    button.danger { border-color: var(--pi-danger); color: var(--pi-danger); }
    button:disabled { opacity: var(--pi-disabled-opacity); cursor: not-allowed; }
    button[aria-busy="true"] { opacity: 1; cursor: progress; }
    button:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-tight); }
    .opening-spinner { position: absolute; inset-inline-start: var(--pi-space-3); top: calc(50% - var(--pi-dot-md) / 2); border-color: color-mix(in srgb, currentColor 25%, transparent); border-top-color: currentColor; }
    @media (pointer: coarse) { button { min-height: var(--pi-control-height-touch); } }
    @media (prefers-reduced-motion: reduce) { .opening-spinner { border-color: currentColor; } }
  `];

  override render() {
    const button = this.button;
    const busy = button.busy === true;
    const classes = [button.primary === true ? "primary" : "", button.tone === "danger" ? "danger" : ""].filter((name) => name !== "").join(" ");
    return html`<button type="button" class=${classes} ?disabled=${busy || button.disabled === true} aria-busy=${busy ? "true" : "false"} @click=${() => { button.run(); }}>${busy ? renderOpeningSpinner() : nothing}${button.label}</button>`;
  }
}

if (customElements.get("pi-web-plugin-button") === undefined) customElements.define("pi-web-plugin-button", PluginButtonElement);

export function renderPluginButton(button: PluginButton): TemplateResult {
  return html`<pi-web-plugin-button .button=${button}></pi-web-plugin-button>`;
}
