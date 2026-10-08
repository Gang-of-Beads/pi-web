import { REORDER_IDLE, TOUCH_DRAG_HOLD_MS, movedTo, reorderRelease, reorderTransition, type ReorderEvent, type ReorderPoint, type ReorderState } from "./listReorder";

/** What the page tells the drag about the list it stands in. */
export interface ReorderHost {
  /** The ids a dragged row moves among, in the order they stand now. */
  readonly order: () => readonly string[];
  /** The row of that list under a point, the dragged one left out; undefined over none. */
  readonly rowAt: (point: ReorderPoint, dragged: string) => string | undefined;
  readonly changed: () => void;
  readonly drop: (order: readonly string[]) => void;
  /** A finger that rested to drag is not also a long press that toggles the row. */
  readonly settleHold: () => void;
}

/**
 * The gestures that drive a row drag on the Navigate page (state diagram D9, `listReorder.ts`).
 *
 * A mouse press on an ordered row is ready at once and drags past a few pixels; a click that never
 * moved is still the row's own. A finger is ready only in batch mode: the press whose long hold
 * entered it drags as soon as it moves, and a later press after resting `TOUCH_DRAG_HOLD_MS`, so a quick swipe
 * over the rows still scrolls. Touch drags ride touch events rather than pointer events, because
 * Android Chrome may cancel the pointer of a long press, and the page stops the scroll by
 * preventing `touchmove` while a press is ready. The click a mouse drop synthesises is swallowed.
 */
export class NavigateReorder {
  private current: ReorderState = REORDER_IDLE;
  private holdTimer: number | undefined;
  private dropClick = false;

  constructor(private readonly host: ReorderHost) {}

  get state(): ReorderState {
    return this.current;
  }

  /** Where the press began, for the page to keep the lifted row under the pointer. */
  get pressOrigin(): ReorderPoint | undefined {
    return this.current.phase === "idle" ? undefined : this.current.origin;
  }

  mouseDown(id: string, event: PointerEvent): void {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    if (event.currentTarget instanceof Element) event.currentTarget.setPointerCapture(event.pointerId);
    this.press({ type: "press", id, pointer: "mouse", at: pointOf(event), ready: true });
  }

  touchStart(id: string, event: TouchEvent, selecting: boolean): void {
    const touch = event.touches[0];
    if (touch === undefined || event.touches.length > 1) {
      this.cancel();
      return;
    }
    this.press({ type: "press", id, pointer: "touch", at: pointOf(touch), ready: false });
    if (!selecting) return;
    this.holdTimer = window.setTimeout(() => {
      this.holdTimer = undefined;
      this.host.settleHold();
      this.dispatch({ type: "held" });
    }, TOUCH_DRAG_HOLD_MS);
  }

  /** Selecting began from the press that is still down: its finger may drag at once. */
  heldBySelection(): void {
    if (this.current.phase === "pressing" && this.current.pointer === "touch") this.dispatch({ type: "held" });
  }

  /** A pointer or finger moved; true when the page must keep the browser from scrolling. */
  move(at: ReorderPoint): boolean {
    const state = this.current;
    if (state.phase === "idle") return false;
    const order = state.phase === "dragging" ? this.orderAt(state.id, state.order, at) : this.host.order();
    this.dispatch({ type: "move", at, order });
    const next = this.current;
    return next.phase === "dragging" || (next.phase === "pressing" && next.ready);
  }

  release(): void {
    const outcome = reorderRelease(this.current);
    this.dispatch({ type: "release" });
    if (outcome.kind !== "drop") return;
    this.dropClick = true;
    this.host.drop(outcome.order);
  }

  cancel(): void {
    this.dispatch({ type: "cancel" });
  }

  /** Any new press clears a swallow the last drop left unused. */
  pressStarted(): void {
    this.dropClick = false;
  }

  /** The page calls this in the capture phase for every click inside it. */
  swallowDropClick(event: MouseEvent): void {
    if (!this.dropClick) return;
    this.dropClick = false;
    event.preventDefault();
    event.stopPropagation();
  }

  private press(event: Extract<ReorderEvent, { type: "press" }>): void {
    this.clearHoldTimer();
    this.dispatch(event);
  }

  private orderAt(id: string, order: readonly string[], at: ReorderPoint): readonly string[] {
    const target = this.host.rowAt(at, id);
    return target === undefined ? order : movedTo(order, id, target);
  }

  private dispatch(event: ReorderEvent): void {
    const previous = this.current;
    const next = reorderTransition(previous, event);
    if (next === previous) return;
    this.current = next;
    if (next.phase !== "pressing") this.clearHoldTimer();
    this.host.changed();
  }

  private clearHoldTimer(): void {
    if (this.holdTimer !== undefined) window.clearTimeout(this.holdTimer);
    this.holdTimer = undefined;
  }
}

function pointOf(source: { readonly clientX: number; readonly clientY: number }): ReorderPoint {
  return { x: source.clientX, y: source.clientY };
}
