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
 * row never changes how it reads.
 */
export function renderRowCells(row: RowAnatomy): TemplateResult {
  return html`
    <span class="title" title=${row.title}>${row.title}</span>
    ${row.status === undefined ? renderValue(row.value) : html`<span class=${`status ${row.status.tone}`}>${row.status.label}</span>`}
    ${row.detail === undefined || row.detail === "" ? nothing : html`<span class="detail">${row.detail}</span>`}
  `;
}

function renderValue(value: string | undefined) {
  return value === undefined ? nothing : html`<span class="value">${value}</span>`;
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
