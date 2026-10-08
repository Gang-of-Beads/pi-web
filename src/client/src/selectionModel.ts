/**
 * Selecting many rows of one list, as one pure state machine (state diagram D9).
 *
 * Owner, 2026-09-30: a long press on a list turns the page into multi-select with the bulk
 * actions at the top; an action returns to the list; an exit key always gets back from an
 * accidental press (docs/design/bulk-selection.md). The page is a dumb executor of this.
 *
 * A selection stays inside one group (live sessions, archived sessions, projects), because the
 * actions differ between them. A destructive action asks in the host's confirm dialog, so
 * "acting" settles either as done, back to the list, or as cancelled, back to the selection.
 */

export type SelectionState<Group extends string> =
  | { readonly phase: "browsing" }
  | { readonly phase: "selecting"; readonly group: Group; readonly ids: ReadonlySet<string> }
  | { readonly phase: "acting"; readonly group: Group; readonly ids: ReadonlySet<string>; readonly action: string };

export type SelectionOutcome = "done" | "cancelled";

export type SelectionEvent<Group extends string> =
  | { readonly type: "hold"; readonly group: Group; readonly id: string }
  | { readonly type: "start"; readonly group: Group }
  | { readonly type: "tap"; readonly group: Group; readonly id: string }
  | { readonly type: "select-all"; readonly ids: readonly string[] }
  | { readonly type: "rows"; readonly ids: ReadonlySet<string> }
  | { readonly type: "choose"; readonly action: string }
  | { readonly type: "settled"; readonly outcome: SelectionOutcome }
  | { readonly type: "exit" };

export const BROWSING = Object.freeze({ phase: "browsing" as const });

type Selecting<Group extends string> = Extract<SelectionState<Group>, { phase: "selecting" }>;
type Acting<Group extends string> = Extract<SelectionState<Group>, { phase: "acting" }>;

export function selectionTransition<Group extends string>(state: SelectionState<Group>, event: SelectionEvent<Group>): SelectionState<Group> {
  if (state.phase === "browsing") return fromBrowsing(event) ?? state;
  if (state.phase === "selecting") return fromSelecting(state, event) ?? state;
  return fromActing(state, event) ?? state;
}

function fromBrowsing<Group extends string>(event: SelectionEvent<Group>): SelectionState<Group> | undefined {
  if (event.type === "hold") return { phase: "selecting", group: event.group, ids: new Set([event.id]) };
  if (event.type === "start") return { phase: "selecting", group: event.group, ids: new Set() };
  return undefined;
}

function fromSelecting<Group extends string>(state: Selecting<Group>, event: SelectionEvent<Group>): SelectionState<Group> | undefined {
  if (event.type === "exit") return BROWSING;
  if (event.type === "tap" || event.type === "hold") return event.group === state.group ? { ...state, ids: toggled(state.ids, event.id) } : undefined;
  if (event.type === "select-all") return { ...state, ids: new Set(event.ids) };
  if (event.type === "rows") return pruned(state, event.ids);
  if (event.type === "choose" && state.ids.size > 0) return { phase: "acting", group: state.group, ids: state.ids, action: event.action };
  return undefined;
}

function fromActing<Group extends string>(state: Acting<Group>, event: SelectionEvent<Group>): SelectionState<Group> | undefined {
  if (event.type !== "settled") return undefined;
  return event.outcome === "done" ? BROWSING : { phase: "selecting", group: state.group, ids: state.ids };
}

function toggled(ids: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(ids);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** A row that left the list (deleted on another device, say) leaves the selection too. */
function pruned<Group extends string>(state: Selecting<Group>, visible: ReadonlySet<string>): SelectionState<Group> {
  const kept = [...state.ids].filter((id) => visible.has(id));
  return kept.length === state.ids.size ? state : { ...state, ids: new Set(kept) };
}

export function isSelecting<Group extends string>(state: SelectionState<Group>): state is Exclude<SelectionState<Group>, { phase: "browsing" }> {
  return state.phase !== "browsing";
}
