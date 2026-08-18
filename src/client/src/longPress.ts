/**
 * Long-press detection for touch surfaces.
 *
 * Multi-select already existed behind a small toolbar toggle, which nobody
 * found: on a phone the gesture people reach for is holding a row. This turns
 * that hold into the same selection mode.
 *
 * Kept as a tiny state machine rather than timers scattered through a
 * component so the parts that decide whether a press counts -- how long, how
 * far a finger may drift, and whether the click that follows must be
 * suppressed -- are testable without a browser.
 */

/** Hold needed before a press counts. Long enough not to fire while scrolling. */
export const LONG_PRESS_MS = 500;

/**
 * Movement allowed during the hold, in CSS pixels.
 *
 * A finger is never perfectly still, so zero would make the gesture unusable;
 * more than a few pixels and a slow scroll starts selecting rows instead.
 */
export const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

export interface LongPressPoint {
  clientX: number;
  clientY: number;
}

export interface LongPressCallbacks {
  /** Fired when the hold completes. */
  onLongPress: () => void;
  setTimer: (callback: () => void, ms: number) => number;
  clearTimer: (handle: number) => void;
}

/**
 * Tracks one press at a time.
 *
 * A second press starting before the first ends cancels it: two fingers on a
 * list is a pinch or a scroll, never a deliberate hold.
 */
export class LongPressTracker {
  private handle: number | undefined;
  private origin: LongPressPoint | undefined;
  private fired = false;

  constructor(private readonly callbacks: LongPressCallbacks) {}

  start(point: LongPressPoint): void {
    this.cancel();
    this.origin = point;
    this.fired = false;
    this.handle = this.callbacks.setTimer(() => {
      this.handle = undefined;
      this.fired = true;
      this.callbacks.onLongPress();
    }, LONG_PRESS_MS);
  }

  /** Cancels the pending press once the finger has drifted too far. */
  move(point: LongPressPoint): void {
    if (this.origin === undefined) return;
    const dx = Math.abs(point.clientX - this.origin.clientX);
    const dy = Math.abs(point.clientY - this.origin.clientY);
    if (dx > LONG_PRESS_MOVE_TOLERANCE_PX || dy > LONG_PRESS_MOVE_TOLERANCE_PX) this.cancel();
  }

  cancel(): void {
    if (this.handle !== undefined) this.callbacks.clearTimer(this.handle);
    this.handle = undefined;
    this.origin = undefined;
  }

  /**
   * Whether the click that follows this press should be ignored.
   *
   * A completed hold is answered by entering selection mode; letting the
   * browser's synthetic click through as well would immediately open the
   * session the user was trying to select. Reading the answer clears it, so a
   * later ordinary tap is unaffected.
   */
  consumeSuppressedClick(): boolean {
    const suppress = this.fired;
    this.fired = false;
    return suppress;
  }
}
