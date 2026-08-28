/** Grace after release, so a tap lands before the transcript moves again. */
const TOUCH_SETTLE_MS = 250;

/** A pointer held longer than this is stuck, not aiming. */
const LONGEST_REAL_TOUCH_MS = 10_000;

/**
 * Whether the transcript may follow the newest message right now.
 *
 * Following pulls everything above the newest content upward, which moves the
 * controls a reader is aiming at. While a finger is down, the reader wins.
 */
export class ScrollFollowGate {
  private pointerDownAt: number | undefined;
  private releasedAt: number | undefined;

  notePointerDown(now: number): void {
    this.pointerDownAt = now;
    this.releasedAt = undefined;
  }

  notePointerUp(now: number): void {
    this.pointerDownAt = undefined;
    this.releasedAt = now;
  }

  followsNewest(now: number): boolean {
    const heldSince = this.pointerDownAt;
    if (heldSince !== undefined) return now - heldSince > LONGEST_REAL_TOUCH_MS;

    const released = this.releasedAt;
    return released === undefined || now - released >= TOUCH_SETTLE_MS;
  }
}
