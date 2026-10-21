import { css, html, LitElement, nothing, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { interactiveSurfaceStyles } from "../shared";
import { openingMarkStyles, renderOpeningSpinner } from "../openingMark";
import type { PluginToggle } from "../../../../shared/pluginApiTypes";

const IDLE_TOGGLE: PluginToggle = { label: "", checked: false, onChange: () => undefined };

/**
 * The checkbox and its label a list row ends in, the way Settings draws its checkboxes: the
 * checkbox at the size Settings uses, the label text the whole target. Draws at least 36px and, like
 * the bar keys, reaches 44px on a coarse pointer without growing the drawn line. While a change is
 * saved the checkbox dims under the host's spinner, the way a busy button shows its spinner.
 */
export const toggleStyles = css`
  ${openingMarkStyles}
  .toggle { position: relative; box-sizing: border-box; display: flex; align-items: center; gap: var(--pi-space-4); min-height: var(--pi-control-height-comfort); min-width: 0; color: var(--pi-text); cursor: pointer; }
  .toggle .checkbox-slot { position: relative; display: inline-flex; flex: 0 0 auto; }
  .toggle input { box-sizing: border-box; width: var(--pi-checkbox-size); height: var(--pi-checkbox-size); margin: 0; accent-color: var(--pi-accent); cursor: inherit; }
  .toggle input:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-tight); }
  .toggle.off { cursor: not-allowed; opacity: var(--pi-disabled-opacity); }
  .toggle.busy { cursor: progress; }
  .toggle.busy input { opacity: var(--pi-disabled-opacity); }
  .toggle .opening-spinner { position: absolute; inset: 0; margin: auto; }
  @media (pointer: coarse) { .toggle::after { content: ""; position: absolute; inset: calc((var(--pi-control-height-comfort) - var(--pi-control-height-touch)) / 2) 0; } }
`;

export function renderCheckbox(toggle: Omit<PluginToggle, "label" | "description">, ariaIds: { readonly label?: string; readonly description?: string }): TemplateResult {
  const busy = toggle.busy === true;
  return html`<span class="checkbox-slot"><input
    type="checkbox"
    .checked=${live(toggle.checked)}
    ?disabled=${busy || toggle.disabled === true}
    aria-busy=${busy ? "true" : "false"}
    aria-labelledby=${ariaIds.label ?? nothing}
    aria-describedby=${ariaIds.description ?? nothing}
    @change=${(event: Event) => { if (event.target instanceof HTMLInputElement) toggle.onChange(event.target.checked); }}
  >${busy ? renderOpeningSpinner() : nothing}</span>`;
}

export function toggleClasses(toggle: Pick<PluginToggle, "disabled" | "busy">): string {
  if (toggle.busy === true) return "toggle busy";
  return toggle.disabled === true ? "toggle off" : "toggle";
}

export class PluginToggleElement extends LitElement {
  @property({ attribute: false }) toggle: PluginToggle = IDLE_TOGGLE;

  static override styles = [interactiveSurfaceStyles, toggleStyles, css`
    :host { display: flex; min-width: 0; max-width: 100%; font: var(--pi-text-sm) var(--pi-font-ui); line-height: 1.4; }
    .text { display: grid; gap: var(--pi-space-1); min-width: 0; overflow-wrap: anywhere; }
    .description { color: var(--pi-muted); font-size: var(--pi-text-xs); }
  `];

  override render() {
    const toggle = this.toggle;
    const hasDescription = toggle.description !== undefined && toggle.description !== "";
    return html`<label class=${toggleClasses(toggle)}>
      ${renderCheckbox(toggle, { label: "label", ...(hasDescription ? { description: "description" } : {}) })}
      <span class="text"><span id="label">${toggle.label}</span>${hasDescription ? html`<span class="description" id="description">${toggle.description}</span>` : nothing}</span>
    </label>`;
  }
}

if (customElements.get("pi-web-plugin-toggle") === undefined) customElements.define("pi-web-plugin-toggle", PluginToggleElement);

export function renderPluginToggle(toggle: PluginToggle): TemplateResult {
  return html`<pi-web-plugin-toggle .toggle=${toggle}></pi-web-plugin-toggle>`;
}
