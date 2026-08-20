import { LongPressTracker } from "../longPress";

/**
 * Open a row's action menu the way each platform expects.
 *
 * The `⋯` button is a small target and, on a phone, an easy one to miss. Both
 * platforms already have a gesture for "act on this thing": hold on touch,
 * right-click with a mouse. This routes both to the menu the button opens, so
 * the button stays for discoverability and the gesture is the accelerator.
 *
 * The tracker cancels when the finger drifts, so a scroll that starts on a row
 * scrolls instead of opening a menu, and the click that a completed hold
 * synthesises is suppressed so the row is not also selected.
 */
export class RowMenuGestures {
  private heldId: string | undefined;
  private readonly longPress: LongPressTracker;

  constructor(private readonly open: (id: string, anchor: EventTarget | null) => void) {
    this.longPress = new LongPressTracker({
      onLongPress: () => {
        if (this.heldId !== undefined) this.open(this.heldId, this.heldAnchor ?? null);
      },
      setTimer: (callback, ms) => window.setTimeout(callback, ms),
      clearTimer: (handle) => { window.clearTimeout(handle); },
    });
  }

  private heldAnchor: EventTarget | null | undefined;

  pointerDown(id: string, event: PointerEvent): void {
    // Mouse right-button presses arrive as pointerdown too; the contextmenu
    // event handles those, so only touch and pen start a hold.
    if (event.pointerType === "mouse") return;
    this.heldId = id;
    this.heldAnchor = event.currentTarget;
    this.longPress.start(event);
  }

  pointerMove(event: PointerEvent): void {
    this.longPress.move(event);
  }

  cancel(): void {
    this.longPress.cancel();
    this.heldId = undefined;
    this.heldAnchor = undefined;
  }

  /** True when the click that follows a completed hold should be ignored. */
  consumeSuppressedClick(): boolean {
    return this.longPress.consumeSuppressedClick();
  }

  contextMenu(id: string, event: MouseEvent): void {
    event.preventDefault();
    this.open(id, event.currentTarget);
  }
}
