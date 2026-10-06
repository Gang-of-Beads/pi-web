import { css, html, LitElement, nothing, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { interactiveSurfaceStyles } from "../shared";
import type { PluginListAction, PluginListGroup, PluginListModel, PluginListRow } from "../../../../shared/pluginApiTypes";
import { pluginListView } from "./pluginListView";

const EMPTY_MODEL: PluginListModel = { read: "reading", groups: [], words: { empty: "", reading: "", failed: "", stale: "" } };

/**
 * The status-page list every plugin hands its rows to (owner, 2026-10-06:
 * the grouped list of mockup A). Section title above a rounded group, rows
 * divided by a hairline, a status as a tone dot and word or a plain muted
 * value on the right, a muted detail line under the title, and the group's
 * buttons in its last row. A page with nothing to show draws one dashed box
 * in the middle of the page.
 */
export class PluginList extends LitElement {
  @property({ attribute: false }) model: PluginListModel = EMPTY_MODEL;

  static override styles = [interactiveSurfaceStyles, css`
    :host { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; overflow: auto; box-sizing: border-box; padding: var(--pi-space-5) var(--pi-reading-edge); color: var(--pi-text); font: var(--pi-text-sm) var(--pi-font-ui); line-height: 1.4; }
    .page { display: grid; gap: var(--pi-space-6); align-content: start; }
    .banner { margin: 0; color: var(--pi-warning); font-size: var(--pi-text-xs); }
    section { display: grid; gap: var(--pi-space-3); min-width: 0; }
    h3 { margin: 0 var(--pi-space-2); color: var(--pi-muted); font-size: var(--pi-text-xs); font-weight: var(--pi-weight-semibold); }
    .group { margin: 0; padding: 0; list-style: none; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); overflow: hidden; }
    .row { box-sizing: border-box; display: grid; grid-template-columns: minmax(40%, 1fr) minmax(0, max-content); align-items: center; gap: var(--pi-space-1) var(--pi-space-5); min-height: var(--pi-control-height-touch); padding: var(--pi-space-4) var(--pi-space-5); }
    .row + .row, .actions { border-top: 1px solid var(--pi-border-muted); }
    .title { min-width: 0; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere; font-weight: var(--pi-weight-semibold); }
    .value { color: var(--pi-muted); text-align: right; overflow-wrap: anywhere; }
    .status { display: inline-flex; align-items: center; gap: var(--pi-space-3); font-size: var(--pi-text-xs); white-space: nowrap; }
    .status::before { content: ""; width: var(--pi-dot-sm); height: var(--pi-dot-sm); border-radius: 50%; background: currentColor; }
    .good { color: var(--pi-success); }
    .attention { color: var(--pi-warning); }
    .problem { color: var(--pi-danger); }
    .neutral { color: var(--pi-muted); }
    .detail { grid-column: 1 / -1; color: var(--pi-dim); font-size: var(--pi-text-xs); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .actions { display: flex; flex-wrap: wrap; gap: var(--pi-space-4); padding: var(--pi-space-4) var(--pi-space-5); }
    .actions button { box-sizing: border-box; min-height: var(--pi-control-height-comfort); display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface-raised); color: var(--pi-text); padding: 0 var(--pi-space-5); font: var(--pi-text-sm) var(--pi-font-ui); cursor: pointer; }
    .actions button.primary { border-color: var(--pi-accent-border); color: var(--pi-accent); }
    .actions button:disabled { opacity: var(--pi-disabled-opacity); cursor: not-allowed; }
    @media (pointer: coarse) { .actions button { min-height: var(--pi-control-height-touch); } }
    .notes { display: grid; gap: var(--pi-space-2); margin: 0 var(--pi-space-2); padding: 0; list-style: none; color: var(--pi-dim); font-size: var(--pi-text-xs); }
    .box { box-sizing: border-box; width: min(100%, 380px); margin: auto; padding: var(--pi-space-8) var(--pi-space-6); border: 1px dashed var(--pi-border); border-radius: var(--pi-radius-lg); color: var(--pi-muted); text-align: center; }
  `];

  override render() {
    const view = pluginListView(this.model);
    if (view.kind === "box") return html`<p class="box" role="status">${view.text}</p>`;
    const notes = this.model.notes ?? [];
    return html`
      <div class="page">
        ${view.banner === undefined ? nothing : html`<p class="banner" role="status">${view.banner}</p>`}
        ${view.groups.map((group) => this.renderGroup(group))}
        ${notes.length === 0 ? nothing : html`<ul class="notes">${notes.map((note) => html`<li>${note}</li>`)}</ul>`}
      </div>
    `;
  }

  private renderGroup(group: PluginListGroup): TemplateResult {
    const actions = group.actions ?? [];
    return html`
      <section>
        ${group.heading === undefined ? nothing : html`<h3>${group.heading}</h3>`}
        <ul class="group">
          ${group.rows.map((row) => this.renderRow(row))}
          ${actions.length === 0 ? nothing : html`<li class="actions">${actions.map((action) => this.renderAction(action))}</li>`}
        </ul>
      </section>
    `;
  }

  private renderRow(row: PluginListRow): TemplateResult {
    return html`
      <li class="row">
        <span class="title" title=${row.title}>${row.title}</span>
        ${row.status === undefined ? this.renderValue(row.value) : html`<span class=${`status ${row.status.tone}`}>${row.status.label}</span>`}
        ${row.detail === undefined || row.detail === "" ? nothing : html`<span class="detail">${row.detail}</span>`}
      </li>
    `;
  }

  private renderValue(value: string | undefined) {
    return value === undefined ? nothing : html`<span class="value">${value}</span>`;
  }

  private renderAction(action: PluginListAction): TemplateResult {
    return html`<button type="button" class=${action.primary === true ? "primary" : ""} ?disabled=${action.disabled === true} @click=${() => { action.run(); }}>${action.label}</button>`;
  }
}

if (customElements.get("pi-web-plugin-list") === undefined) customElements.define("pi-web-plugin-list", PluginList);

export function renderPluginList(model: PluginListModel): TemplateResult {
  return html`<pi-web-plugin-list .model=${model}></pi-web-plugin-list>`;
}
