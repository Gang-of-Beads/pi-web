import { css, html, LitElement, nothing, unsafeCSS, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { interactiveSurfaceStyles } from "../shared";
import { disclosureIconStyle, renderDisclosureIcon } from "../disclosureIcon";
import { renderRowCells, rowAnatomyStyles } from "./rowAnatomy";
import type { PluginExpandableRow } from "../../../../shared/pluginApiTypes";

const CLOSED_ROW: PluginExpandableRow = { title: "", expanded: false, onToggle: () => undefined, body: () => nothing };

let nextBodyId = 0;

/**
 * A row that opens, for a plugin. The whole header is one disclosure button with the host's
 * chevron at its right edge; the body is the plugin's own template, under a hairline in the same
 * cell, and is not drawn at all while the row is closed. The plugin owns `expanded`, so it decides
 * which rows are open and keeps that by its own scope. Raw markup in the body gets only this
 * element's base text style: a plugin that wants its own arrangement draws one element of its own
 * there and lays host components out inside it.
 */
export class PluginExpandableRowElement extends LitElement {
  @property({ attribute: false }) row: PluginExpandableRow = CLOSED_ROW;
  private readonly bodyId = `plugin-row-body-${String(++nextBodyId)}`;

  static override styles = [interactiveSurfaceStyles, rowAnatomyStyles, css`${unsafeCSS(disclosureIconStyle)}`, css`
    :host { display: block; min-width: 0; color: var(--pi-text); font: var(--pi-text-sm) var(--pi-font-ui); line-height: 1.4; }
    .header { box-sizing: border-box; display: grid; grid-template-columns: minmax(40%, 1fr) minmax(0, max-content) auto; align-items: center; gap: var(--pi-space-1) var(--pi-space-5); width: 100%; min-height: var(--pi-control-height-touch); padding: var(--pi-space-4) var(--pi-space-5); border: 0; background: transparent; color: inherit; font: inherit; text-align: start; cursor: pointer; }
    .header:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: calc(-1 * var(--pi-focus-ring-width)); }
    .disclosure-icon { grid-column: 3; grid-row: 1; color: var(--pi-muted); }
    .body { box-sizing: border-box; display: grid; gap: var(--pi-space-4); min-width: 0; padding: var(--pi-space-4) var(--pi-space-5) var(--pi-space-5); border-top: 1px solid var(--pi-border-muted); overflow-wrap: anywhere; }
  `];

  override render() {
    const row = this.row;
    return html`
      <button type="button" class="header" aria-expanded=${row.expanded ? "true" : "false"} aria-controls=${this.bodyId} @click=${() => { row.onToggle(); }}>
        ${renderRowCells(row)}
        ${renderDisclosureIcon(!row.expanded)}
      </button>
      ${row.expanded ? html`<div class="body" id=${this.bodyId} role="region" aria-label=${row.title}>${row.body()}</div>` : nothing}
    `;
  }
}

if (customElements.get("pi-web-plugin-expandable-row") === undefined) customElements.define("pi-web-plugin-expandable-row", PluginExpandableRowElement);

export function renderPluginExpandableRow(row: PluginExpandableRow): TemplateResult {
  return html`<pi-web-plugin-expandable-row .row=${row}></pi-web-plugin-expandable-row>`;
}
