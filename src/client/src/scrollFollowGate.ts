/** Grace after release, so a tap lands before the transcript moves again. */
export const TOUCH_SETTLE_MS = 250;

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
  private suppressedFollow = false;

  notePointerDown(now: number): void {
    this.pointerDownAt = now;
    this.releasedAt = undefined;
  }

  notePointerUp(now: number): void {
    this.pointerDownAt = undefined;
    this.releasedAt = now;
  }

  /**
   * Whether a finger is on the glass right now.
   *
   * Separate from followsNewest, which forgives a press held longer than any
   * real touch so a stuck pointer cannot freeze following forever. Moving the
   * transcript under a press is a different question: the ground must not shift
   * while it is being touched, however long the touch has lasted.
   */
  pointerIsDown(): boolean {
    return this.pointerDownAt !== undefined;
  }

  /**
   * Whether the reader is mid-press or inside the release grace - the span
   * during which the ground under the finger must not change. Pure: render
   * paths ask this every frame, and a probe that recorded a suppressed follow
   * as a side effect would turn asking into acting.
   */
  holdsOrSettling(now: number): boolean {
    const heldSince = this.pointerDownAt;
    if (heldSince !== undefined) return now - heldSince <= LONGEST_REAL_TOUCH_MS;
    const released = this.releasedAt;
    return released !== undefined && now - released < TOUCH_SETTLE_MS;
  }

  followsNewest(now: number): boolean {
    const heldSince = this.pointerDownAt;
    if (heldSince !== undefined) {
      if (now - heldSince > LONGEST_REAL_TOUCH_MS) return true;
      this.suppressedFollow = true;
      return false;
    }

    const released = this.releasedAt;
    if (released === undefined || now - released >= TOUCH_SETTLE_MS) return true;
    this.suppressedFollow = true;
    return false;
  }

  /**
   * Whether a follow was refused while the reader was touching, so the caller
   * can apply it now that the press is over. Reported once: a reader who
   * scrolled away during the press must not be dragged back to the bottom.
   */
  takeSuppressedFollow(): boolean {
    const suppressed = this.suppressedFollow;
    this.suppressedFollow = false;
    return suppressed;
  }
}
