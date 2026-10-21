import { css, html, LitElement, nothing, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { interactiveSurfaceStyles } from "../shared";
import { openingMarkStyles, renderOpeningSpinner } from "../openingMark";
import type { PluginButton } from "../../../../shared/pluginApiTypes";

const IDLE_BUTTON: PluginButton = { label: "", run: () => undefined };

/**
 * A plugin's button, drawn the way the host's status lists draw theirs. Busy keeps the label and
 * puts the spinner in the start padding, so a press never makes the button change width under the
 * finger; the padding is wide enough to hold it at every state. It draws 36px on every pointer and,
 * like the bar keys, reaches 44px on a coarse pointer without growing the drawn box (owner,
 * 2026-10-21: the 44px drawn button read as a different family from the chrome around it). The
 * reach overhangs 4px above and below, so wrapped rows of buttons need a gap of at least 8px.
 * A label wraps between words but never inside one (`break-word`, not `anywhere`): `anywhere`
 * makes the min-content width one letter, so a flex row beside a growing field squeezed "Stop"
 * to "Sto / p".
 */
export class PluginButtonElement extends LitElement {
  @property({ attribute: false }) button: PluginButton = IDLE_BUTTON;

  static override styles = [interactiveSurfaceStyles, openingMarkStyles, css`
    :host { display: inline-flex; max-width: 100%; }
    button { position: relative; box-sizing: border-box; max-width: 100%; min-height: var(--pi-control-height-comfort); display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface-raised); color: var(--pi-text); padding: 0 var(--pi-space-6); font: var(--pi-text-sm) var(--pi-font-ui); overflow-wrap: break-word; cursor: pointer; }
    button.primary { border-color: var(--pi-accent-border); color: var(--pi-accent); }
    button.danger { border-color: var(--pi-danger); color: var(--pi-danger); }
    button:disabled { opacity: var(--pi-disabled-opacity); cursor: not-allowed; }
    button[aria-busy="true"] { opacity: 1; cursor: progress; }
    button:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-tight); }
    .opening-spinner { position: absolute; inset-inline-start: var(--pi-space-1); top: calc(50% - var(--pi-dot-md) / 2); border-color: color-mix(in srgb, currentColor 25%, transparent); border-top-color: currentColor; }
    @media (pointer: coarse) { button::after { content: ""; position: absolute; inset: calc((var(--pi-control-height-comfort) - var(--pi-control-height-touch)) / 2 - 1px) -1px; } }
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
