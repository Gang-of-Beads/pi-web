/**
 * A finger held on a shell tab renames it (R12, owner 2026-10-09): the gesture a phone has instead of
 * a double-click. The hold matches the host's own (`longPress.ts`, 500 ms, 10 px of drift), which a
 * plugin cannot import. A mouse press never counts: a mouse has the double-click. The tab buttons
 * suppress text selection and the platform callout so a hold reads only as a rename.
 */
const HOLD_MS = 500;
const HOLD_DRIFT_PX = 10;

export class TabHold {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private origin: { x: number; y: number } | undefined;
  private fired = false;

  constructor(private readonly onHold: (terminalId: string) => void) {}

  start(event: PointerEvent, terminalId: string): void {
    this.cancel();
    this.fired = false;
    if (event.pointerType === "mouse") return;
    this.origin = { x: event.clientX, y: event.clientY };
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.fired = true;
      this.onHold(terminalId);
    }, HOLD_MS);
  }

  /** A finger that drifts is scrolling the tabs, not holding one. */
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

  /** Whether the click after this press belongs to the hold, which already answered it. Reading clears it. */
  consumeClick(): boolean {
    const fired = this.fired;
    this.fired = false;
    return fired;
  }
}
