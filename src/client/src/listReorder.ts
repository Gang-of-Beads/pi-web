/**
 * Dragging a row of an ordered list to another place, as one pure state machine (state diagram D9,
 * R11; owner, 2026-10-09: a long press enters batch mode, and dragging there moves a row; on the
 * desktop a press and drag moves it, and a click still opens).
 *
 * The page is the executor: it says where the pointer is and what order the list would take with
 * the row under it, and draws what the state says. A drop hands back the whole new order, never a
 * move, so a repeated or late request cannot scramble the list.
 */

export type ReorderPointer = "mouse" | "touch";

export interface ReorderPoint {
  readonly x: number;
  readonly y: number;
}

export type ReorderState =
  | { readonly phase: "idle" }
  | { readonly phase: "pressing"; readonly id: string; readonly pointer: ReorderPointer; readonly origin: ReorderPoint; readonly ready: boolean }
  | { readonly phase: "dragging"; readonly id: string; readonly pointer: ReorderPointer; readonly origin: ReorderPoint; readonly at: ReorderPoint; readonly order: readonly string[] };

export type ReorderEvent =
  | { readonly type: "press"; readonly id: string; readonly pointer: ReorderPointer; readonly at: ReorderPoint; readonly ready: boolean }
  | { readonly type: "held" }
  | { readonly type: "move"; readonly at: ReorderPoint; readonly order: readonly string[] }
  | { readonly type: "release" }
  | { readonly type: "cancel" };

/** What a release meant: a press that never became a drag (the row's own tap), a drop with its order, or nothing. */
export type ReorderRelease = { readonly kind: "tap" } | { readonly kind: "drop"; readonly order: readonly string[] } | { readonly kind: "none" };

export const REORDER_IDLE: ReorderState = Object.freeze({ phase: "idle" });

/** A ready press becomes a drag past this distance; a mouse jitter is not a drag. */
export const DRAG_START_PX = 4;

/** A touch that moves this far before it is ready is a scroll, and gives the press up. */
export const SCROLL_START_PX = 10;

/** How long a finger rests on a row in batch mode before moving it drags instead of scrolling. */
export const TOUCH_DRAG_HOLD_MS = 200;

type Pressing = Extract<ReorderState, { phase: "pressing" }>;
type Dragging = Extract<ReorderState, { phase: "dragging" }>;

export function reorderTransition(state: ReorderState, event: ReorderEvent): ReorderState {
  if (event.type === "press") return { phase: "pressing", id: event.id, pointer: event.pointer, origin: event.at, ready: event.ready };
  if (event.type === "cancel" || event.type === "release") return REORDER_IDLE;
  if (state.phase === "pressing") return fromPressing(state, event);
  if (state.phase === "dragging" && event.type === "move") return { ...state, at: event.at, order: event.order };
  return state;
}

function fromPressing(state: Pressing, event: Exclude<ReorderEvent, { type: "press" | "cancel" | "release" }>): ReorderState {
  if (event.type === "held") return state.ready ? state : { ...state, ready: true };
  const moved = Math.hypot(event.at.x - state.origin.x, event.at.y - state.origin.y);
  if (!state.ready) return state.pointer === "touch" && moved > SCROLL_START_PX ? REORDER_IDLE : state;
  if (moved <= DRAG_START_PX) return state;
  const dragging: Dragging = { phase: "dragging", id: state.id, pointer: state.pointer, origin: state.origin, at: event.at, order: event.order };
  return dragging;
}

/** Read before dispatching "release": what the press that is ending amounted to. */
export function reorderRelease(state: ReorderState): ReorderRelease {
  if (state.phase === "dragging") return { kind: "drop", order: state.order };
  if (state.phase === "pressing") return { kind: "tap" };
  return { kind: "none" };
}

/** The order with `id` moved to where `target` stands; the same order when either is missing. */
export function movedTo(order: readonly string[], id: string, target: string): readonly string[] {
  const from = order.indexOf(id);
  const to = order.indexOf(target);
  if (from === -1 || to === -1 || from === to) return order;
  const next = order.filter((entry) => entry !== id);
  next.splice(to, 0, id);
  return next;
}
