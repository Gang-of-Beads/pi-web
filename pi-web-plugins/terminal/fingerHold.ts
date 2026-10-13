/**
 * A finger held still on the terminal: on a shell tab it renames the shell (R12, owner 2026-10-09),
 * on the terminal's text it selects the word under it (owner 2026-10-13), the gesture a phone has
 * instead of a double-click or a mouse drag. The hold matches the host's own (`longPress.ts`,
 * 500 ms, 10 px of drift), which a plugin cannot import. A mouse press never counts: a mouse has the
 * double-click and the drag. A second finger is a pinch, not a hold. Each surface owns one hold, so
 * the tab's and the text's never answer each other's press.
 */
const HOLD_MS = 500;
const HOLD_DRIFT_PX = 10;

export class FingerHold<Subject> {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private origin: { x: number; y: number } | undefined;
  private fired = false;

  constructor(private readonly onHold: (subject: Subject) => void) {}

  start(event: PointerEvent, subject: Subject): void {
    this.cancel();
    this.fired = false;
    if (event.pointerType === "mouse" || !event.isPrimary) return;
    this.origin = { x: event.clientX, y: event.clientY };
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.fired = true;
      this.onHold(subject);
    }, HOLD_MS);
  }

  /** A finger that drifts is scrolling, not holding. */
  move(event: PointerEvent): void {
    if (this.origin === undefined) return;
    if (Math.abs(event.clientX - this.origin.x) > HOLD_DRIFT_PX || Math.abs(event.clientY - this.origin.y) > HOLD_DRIFT_PX) this.cancel();
  }

  /** Ends the press but keeps a completed hold's claim on the click the browser sends after it. */
  cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.origin = undefined;
  }

  /** Ends the press; true when it was a tap: lifted before the hold fired, without drifting. */
  release(): boolean {
    const tap = this.timer !== undefined;
    this.cancel();
    return tap;
  }

  /** Whether a finger is down or its hold just fired: a context menu now is the finger's long-press, not a right-click. */
  fingerPressed(): boolean {
    return this.origin !== undefined || this.fired;
  }

  /** Whether the click after this press belongs to the hold, which already answered it. Reading clears it. */
  consumeClick(): boolean {
    const fired = this.fired;
    this.fired = false;
    return fired;
  }
}
