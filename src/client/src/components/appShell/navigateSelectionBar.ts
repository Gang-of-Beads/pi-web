import { css, html, nothing } from "lit";
import type { NavigateBulkAction, NavigateBulkActionId } from "../../navigateRowActions";
import type { NavigateSelectionState } from "../../navigateSelection";
import { renderCrossIcon } from "../uiIcons.js";

export interface SelectionBarInput {
  readonly state: Exclude<NavigateSelectionState, { phase: "browsing" }>;
  readonly actions: readonly NavigateBulkAction[];
  /** Every row of the selected group the list shows; Select all takes these. */
  readonly visibleIds: readonly string[];
  readonly onExit: () => void;
  readonly onSelectAll: (ids: readonly string[]) => void;
  readonly onChoose: (action: NavigateBulkActionId, ids: readonly string[]) => void;
}

/**
 * Selecting is a page of its own (owner, 2026-10-09: "batch mode can be like a new page that
 * hides the keys underneath; too many keys otherwise"). Its header takes the place of the path
 * bar, the kinds and the search, drawn in the path bar's own keys: the way out where the grid
 * key stands, the count as the title, Select all at the end. Under it, the actions that fit the
 * selection, every key the same size (owner, 2026-10-09). While an action runs, every key waits.
 */
export function renderSelectionHeader(input: SelectionBarInput) {
  const acting = input.state.phase === "acting";
  const everything = input.visibleIds.length > 0 && input.visibleIds.every((id) => input.state.ids.has(id));
  return html`
    <header class="path-bar selection-header" role="toolbar" aria-label="Selected rows" aria-busy=${acting ? "true" : "false"}>
      <button type="button" class="quick-access" title="Done" aria-label="Done" ?disabled=${acting} @click=${input.onExit}>${renderCrossIcon()}</button>
      <span class="selection-count" role="status">${input.state.ids.size} selected</span>
      <button type="button" class="path-step" ?disabled=${acting || everything} @click=${() => { input.onSelectAll(input.visibleIds); }}>Select all</button>
    </header>
  `;
}

export function renderSelectionActions(input: SelectionBarInput) {
  const acting = input.state.phase === "acting";
  const count = input.state.ids.size;
  return html`
    <div class="selection-actions">
      ${input.actions.map((action) => html`
        <button type="button" class="selection-key" ?disabled=${acting} @click=${() => { input.onChoose(action.id, action.ids); }}>${action.label}${action.ids.length === count ? nothing : html` <small>(${action.ids.length})</small>`}</button>
      `)}
    </div>
  `;
}

/**
 * The page that draws these already carries the shared touch contract; the action keys state it
 * again so the module keeps it wherever it is drawn. One flat sheet, so the page's `styles` stays
 * a flat list.
 */
export const selectionBarStyles = css`
  .selection-header button, .selection-actions button { -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
  .selection-header { gap: var(--pi-space-3); }
  .selection-count { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--pi-text); font-weight: var(--pi-weight-semibold); }
  .selection-header button:disabled { opacity: var(--pi-disabled-opacity); cursor: default; }
  /* The actions share the row in equal columns, a long label wrapping inside its own key
     rather than widening it. */
  .selection-actions { flex: 0 0 auto; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); align-items: stretch; gap: var(--pi-space-3); padding: var(--pi-space-3) var(--pi-bar-inset) 0; }
  .selection-key { box-sizing: border-box; min-width: 0; min-height: var(--pi-control-height-comfort); padding: var(--pi-space-2) var(--pi-space-3); border: 1px solid var(--pi-accent-border); border-radius: var(--pi-radius-md); background: var(--pi-selection-bg); color: var(--pi-text-bright); font: inherit; line-height: 1.2; overflow-wrap: anywhere; cursor: pointer; }
  .selection-key:disabled { opacity: var(--pi-disabled-opacity); cursor: default; }
  .selection-key small { color: var(--pi-muted); font-size: var(--pi-text-2xs); }
  @media (pointer: coarse) { .selection-key { min-height: var(--pi-control-height-touch, 44px); } }
`;
