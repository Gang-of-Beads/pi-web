import { css, html, LitElement, nothing, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { interactiveSurfaceStyles, pageScrollerStyles } from "../shared";
import type { PluginButton, PluginListGroup, PluginListModel, PluginListRow, PluginListRowToggle, PluginRowExpansion } from "../../../../shared/pluginApiTypes";
import { pluginListView } from "./pluginListView";
import { leadingRowCellIds, renderLeadingRowCells, renderRowCells, rowAnatomyStyles } from "../pluginUi/rowAnatomy";
import { renderPluginButton, renderPluginRowButton } from "../pluginUi/PluginButton";
import { renderPluginExpandableRow } from "../pluginUi/PluginExpandableRow";
import { renderCheckbox, toggleClasses, toggleStyles } from "../pluginUi/PluginToggle";

const EMPTY_MODEL: PluginListModel = { read: "reading", groups: [], words: { empty: "", reading: "", failed: "", stale: "" } };

/** How a row is drawn: one that opens wins over its controls, and a checkbox over a button. */
type RowShape =
  | { readonly kind: "opens"; readonly expansion: PluginRowExpansion }
  | { readonly kind: "toggle"; readonly toggle: PluginListRowToggle }
  | { readonly kind: "action"; readonly action: PluginButton }
  | { readonly kind: "flat" };

function rowShape(row: PluginListRow): RowShape {
  if (row.expansion !== undefined) return { kind: "opens", expansion: row.expansion };
  if (row.toggle !== undefined) return { kind: "toggle", toggle: row.toggle };
  return row.action === undefined ? { kind: "flat" } : { kind: "action", action: row.action };
}

function renderRow(row: PluginListRow, idPrefix: string): TemplateResult {
  const shape = rowShape(row);
  switch (shape.kind) {
    case "opens": return html`<li class="row opens">${renderPluginExpandableRow({ ...row, ...shape.expansion })}</li>`;
    case "toggle": return html`<li class="row switch"><label class=${`keyed ${toggleClasses(shape.toggle)}`}>${renderLeadingRowCells(row, idPrefix)}${renderCheckbox(shape.toggle, leadingRowCellIds(row, idPrefix))}</label></li>`;
    case "action": return html`<li class="row keyed">${renderLeadingRowCells(row, idPrefix)}${renderPluginRowButton(shape.action, row.title)}</li>`;
    case "flat": return html`<li class="row">${renderRowCells(row)}</li>`;
  }
}

/**
 * The status-page list every plugin hands its rows to (owner, 2026-10-06:
 * the grouped list of mockup A). Section title above a rounded group, rows
 * divided by a hairline, a status as a tone dot and word or a plain muted
 * value on the right, a muted detail line under the title, and the group's
 * buttons in its last row. A page with nothing to show draws one dashed box
 * in the middle of the page. A row with `expansion` opens (the element
 * `renderPluginExpandableRow` draws), and a group may put one button at the right of
 * its heading line. A row may end in its own button or checkbox; its status or value then leads
 * the detail line, so the control has the right end to itself.
 */
export class PluginList extends LitElement {
  @property({ attribute: false }) model: PluginListModel = EMPTY_MODEL;

  override connectedCallback(): void {
    super.connectedCallback();
    this.classList.add("page-scroller");
  }

  static override styles = [interactiveSurfaceStyles, rowAnatomyStyles, toggleStyles, pageScrollerStyles, css`
    :host { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; overflow: auto; box-sizing: border-box; padding: var(--pi-space-5) var(--pi-reading-edge); color: var(--pi-text); font: var(--pi-text-sm) var(--pi-font-ui); line-height: 1.4; }
    .page { display: grid; gap: var(--pi-space-6); align-content: start; }
    .banner { margin: 0; color: var(--pi-warning); font-size: var(--pi-text-xs); }
    section { display: grid; gap: var(--pi-space-3); min-width: 0; }
    .heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--pi-space-4); margin: 0 var(--pi-space-2); }
    .heading > h3 { flex: 1 1 0; }
    .heading > :not(h3) { flex: 0 0 auto; }
    h3 { margin: 0; color: var(--pi-muted); font-size: var(--pi-text-xs); font-weight: var(--pi-weight-semibold); }
    .group { margin: 0; padding: 0; list-style: none; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); overflow: hidden; }
    .row { box-sizing: border-box; display: grid; grid-template-columns: minmax(40%, 1fr) minmax(0, max-content); align-items: center; gap: var(--pi-space-1) var(--pi-space-5); min-height: var(--pi-control-height-touch); padding: var(--pi-space-4) var(--pi-space-5); }
    .row.opens { display: block; padding: 0; }
    .row.keyed, .row.switch > .keyed { display: flex; align-items: center; gap: var(--pi-space-5); }
    .row.keyed > .cells, .row.switch .cells { flex: 1 1 auto; }
    .row.keyed > :last-child { flex: 0 0 auto; }
    .row.switch { display: block; padding: 0; }
    .row.switch > .keyed { box-sizing: border-box; min-height: var(--pi-control-height-touch); padding: var(--pi-space-4) var(--pi-space-5); }
    .row.switch .toggle::after { content: none; }
    .row + .row, .row + .actions { border-top: 1px solid var(--pi-border-muted); }
    .actions { display: flex; flex-wrap: wrap; gap: var(--pi-space-4); padding: var(--pi-space-4) var(--pi-space-5); }
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
        ${repeat(view.groups, (group) => group.id, (group) => this.renderGroup(group))}
        ${notes.length === 0 ? nothing : html`<ul class="notes">${notes.map((note) => html`<li>${note}</li>`)}</ul>`}
      </div>
    `;
  }

  private renderGroup(group: PluginListGroup): TemplateResult {
    const actions = group.actions ?? [];
    return html`
      <section>
        ${this.renderHeading(group)}
        <ul class="group">
          ${repeat(group.rows, (row) => row.id, (row) => renderRow(row, `row-${group.id}-${row.id}`))}
          ${actions.length === 0 ? nothing : html`<li class="actions">${repeat(actions, (action) => action.id, (action) => renderPluginButton(action))}</li>`}
        </ul>
      </section>
    `;
  }

  private renderHeading(group: PluginListGroup) {
    const heading = group.heading === undefined ? nothing : html`<h3>${group.heading}</h3>`;
    if (group.headingAction === undefined) return heading;
    return html`<div class="heading">${heading}${renderPluginButton(group.headingAction)}</div>`;
  }
}

if (customElements.get("pi-web-plugin-list") === undefined) customElements.define("pi-web-plugin-list", PluginList);

export function renderPluginList(model: PluginListModel): TemplateResult {
  return html`<pi-web-plugin-list .model=${model}></pi-web-plugin-list>`;
}
