import { css, html, nothing, type TemplateResult } from "lit";
import type { PluginListStatus } from "../../../../shared/pluginApiTypes";

/** What a row shows, whether it is a list row or a row that opens. */
export interface RowAnatomy {
  readonly title: string;
  readonly status?: PluginListStatus;
  readonly value?: string;
  readonly detail?: string;
}

/**
 * The one row anatomy every plugin row is drawn with (docs/design/plugin-list-component.md): the
 * title wrapping to two lines, a tone dot and word or a muted value on the right, a muted detail
 * line under the title. A flat list row and a row that opens draw the same cells, so opening a
 * row never changes how it reads. `idPrefix` gives the right-hand cell and the detail ids, for a
 * control that describes itself by them (`rowDescribedBy`).
 */
export function renderRowCells(row: RowAnatomy, idPrefix?: string): TemplateResult {
  const ids = idPrefix === undefined ? undefined : rowCellIds(idPrefix);
  return html`
    <span class="title" title=${row.title}>${row.title}</span>
    ${row.status === undefined ? renderValue(row.value, ids?.side) : html`<span class=${`status ${row.status.tone}`} id=${ids?.side ?? nothing}>${row.status.label}</span>`}
    ${hasDetail(row) ? html`<span class="detail" id=${ids?.detail ?? nothing}>${row.detail}</span>` : nothing}
  `;
}

/**
 * The ids of the cells that describe a row that is a control. A plugin may put a ticking time in
 * the value or the detail (a run's "12s so far"); in the control's name it renamed the control
 * every second, so screen readers read it again and automation refs churned. The name is the
 * title alone, and these cells, drawn as before, are its description, which is not a live region.
 */
export function rowDescribedBy(row: RowAnatomy, idPrefix: string): string | undefined {
  const ids = rowCellIds(idPrefix);
  const described = [row.status !== undefined || row.value !== undefined ? ids.side : undefined, hasDetail(row) ? ids.detail : undefined];
  const present = described.filter((id) => id !== undefined);
  return present.length === 0 ? undefined : present.join(" ");
}

function rowCellIds(idPrefix: string): { side: string; detail: string } {
  return { side: `${idPrefix}-side`, detail: `${idPrefix}-detail` };
}

function hasDetail(row: RowAnatomy): boolean {
  return row.detail !== undefined && row.detail !== "";
}

function renderValue(value: string | undefined, id: string | undefined) {
  return value === undefined ? nothing : html`<span class="value" id=${id ?? nothing}>${value}</span>`;
}

export const rowAnatomyStyles = css`
  .title { min-width: 0; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere; font-weight: var(--pi-weight-semibold); }
  .value { color: var(--pi-muted); text-align: right; overflow-wrap: anywhere; }
  .status { display: inline-flex; align-items: center; gap: var(--pi-space-3); font-size: var(--pi-text-xs); white-space: nowrap; }
  .status::before { content: ""; width: var(--pi-dot-sm); height: var(--pi-dot-sm); border-radius: 50%; background: currentColor; }
  .good { color: var(--pi-success); }
  .attention { color: var(--pi-warning); }
  .problem { color: var(--pi-danger); }
  .neutral { color: var(--pi-muted); }
  .detail { grid-column: 1 / -1; color: var(--pi-dim); font-size: var(--pi-text-xs); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
`;
