import { LongPressTracker } from "./longPress";
import type { NavigateBulkGroup } from "./navigateRowActions";
import { BROWSING, isSelecting, selectionTransition, type SelectionEvent, type SelectionState } from "./selectionModel";

export type NavigateSelectionState = SelectionState<NavigateBulkGroup>;

/** What a click on a row turned out to be: the row's own action, or part of selecting. */
export type RowClickVerdict = "row" | "selection";

const SELECTION_MODIFIER_KEYS = ["shiftKey", "metaKey", "ctrlKey"] as const;

/**
 * The gestures that drive the Navigate page's selection (state diagram D9), kept out of the
 * page: a touch or pen hold enters it with the held row (owner, 2026-09-30: the phone's long
 * press), a Shift or Cmd/Ctrl click does the same on the desktop, and while selecting a tap
 * toggles a row instead of opening it.
 *
 * The click a completed hold synthesises on release is swallowed wherever it lands: on the held
 * row it would toggle the row straight back off, and entering selecting can move the list under
 * the finger (the bar is taller than the Projects header), so it may land on one of the bar's
 * action keys and run it.
 *
 * The mouse never starts a hold: on the desktop a press is the row's own (and, with reordering,
 * a drag), and the menu is the right-click's.
 *
 * A press reaches the hold by either of two paths, and the first one wins: the 500 ms timer, or
 * the browser's own long press, which Android Chrome reports as a touch `contextmenu` and may
 * follow with `pointercancel` before the timer runs (the owner's phone did not enter selecting
 * on 8505 where desktop Chromium with synthetic touches did).
 */
export class NavigateSelection {
  private current: NavigateSelectionState = BROWSING;
  private held: { readonly group: NavigateBulkGroup; readonly id: string } | undefined;
  /** This press already reached the hold, by either path; its release is not a tap. */
  private pressHeld = false;
  private readonly longPress: LongPressTracker;

  constructor(private readonly changed: (next: NavigateSelectionState, previous: NavigateSelectionState) => void) {
    this.longPress = new LongPressTracker({
      onLongPress: () => { this.reachHold(); },
      setTimer: (callback, ms) => window.setTimeout(callback, ms),
      clearTimer: (handle) => { window.clearTimeout(handle); },
    });
  }

  get state(): NavigateSelectionState {
    return this.current;
  }

  dispatch(event: SelectionEvent<NavigateBulkGroup>): void {
    const previous = this.current;
    const next = selectionTransition(previous, event);
    if (next === previous) return;
    this.current = next;
    this.changed(next, previous);
  }

  pointerDown(group: NavigateBulkGroup | undefined, id: string, event: PointerEvent): void {
    this.pressHeld = false;
    if (group === undefined || event.pointerType === "mouse") return;
    this.held = { group, id };
    this.longPress.start(event);
  }

  /** Any press inside the page starts afresh: only the release of the press that held is swallowed. */
  pressStarted(): void {
    this.pressHeld = false;
  }

  /** The browser's long press on a selectable row: the hold, unless the timer got there first. */
  touchContextMenu(group: NavigateBulkGroup | undefined, id: string, event: MouseEvent): void {
    if (group === undefined) return;
    event.preventDefault();
    this.held = { group, id };
    this.longPress.cancel();
    this.reachHold();
  }

  private reachHold(): void {
    if (this.held === undefined || this.pressHeld) return;
    this.pressHeld = true;
    if ("vibrate" in navigator) navigator.vibrate(10);
    this.dispatch({ type: "hold", ...this.held });
  }

  pointerMove(event: PointerEvent): void {
    this.longPress.move(event);
  }

  pointerEnd(): void {
    this.longPress.cancel();
  }

  /** Swallow the release of a completed hold; the page calls this in the capture phase for every click inside it. */
  swallowHoldRelease(event: MouseEvent): void {
    this.longPress.consumeSuppressedClick();
    if (!this.pressHeld) return;
    this.pressHeld = false;
    event.preventDefault();
    event.stopPropagation();
  }

  click(group: NavigateBulkGroup | undefined, id: string, event: MouseEvent): RowClickVerdict {
    if (group === undefined) return isSelecting(this.current) ? "selection" : "row";
    if (isSelecting(this.current)) {
      this.dispatch({ type: "tap", group, id });
      return "selection";
    }
    if (!SELECTION_MODIFIER_KEYS.some((key) => event[key])) return "row";
    this.dispatch({ type: "hold", group, id });
    return "selection";
  }
}
