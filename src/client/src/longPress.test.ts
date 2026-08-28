import { describe, expect, it } from "vitest";
import { LONG_PRESS_MOVE_TOLERANCE_PX, LongPressTracker } from "./longPress";

/**
 * A tracker whose timer is driven by the test rather than by the clock, so a
 * hold either completes or does not because the test said so.
 */
function trackerHarness() {
  let pending: (() => void) | undefined;
  let longPresses = 0;
  const tracker = new LongPressTracker({
    onLongPress: () => { longPresses += 1; },
    setTimer: (callback) => { pending = callback; return 1; },
    clearTimer: () => { pending = undefined; },
  });
  return {
    tracker,
    get longPresses() { return longPresses; },
    /** Let the hold reach its full duration. */
    completeHold() { const run = pending; pending = undefined; run?.(); },
    holdPending() { return pending !== undefined; },
  };
}

const ORIGIN = { clientX: 100, clientY: 100 };

describe("a press that becomes a hold", () => {
  it("reports the hold once its time has passed", () => {
    const harness = trackerHarness();

    harness.tracker.start(ORIGIN);
    harness.completeHold();

    expect(harness.longPresses).toBe(1);
  });

  /**
   * A completed hold is answered by opening the menu; letting the browser's
   * synthetic click through as well would also activate the row underneath.
   *
   * The order here is the browser's, and it is the whole difficulty: every row
   * ends its press on `pointerup`, and `pointerup` arrives *before* the click.
   * So the suppression has to survive the press ending and be spent by the
   * click that follows.
   */
  it("suppresses the click the browser synthesises after it", () => {
    const harness = trackerHarness();

    harness.tracker.start(ORIGIN);
    harness.completeHold();
    harness.tracker.cancel(); // pointerup

    expect(harness.tracker.consumeSuppressedClick()).toBe(true);
  });

  it("suppresses only that one click", () => {
    const harness = trackerHarness();

    harness.tracker.start(ORIGIN);
    harness.completeHold();
    harness.tracker.consumeSuppressedClick();

    expect(harness.tracker.consumeSuppressedClick()).toBe(false);
  });
});

describe("a press that never becomes a hold", () => {
  it("does not report a hold when the finger drifts away", () => {
    const harness = trackerHarness();

    harness.tracker.start(ORIGIN);
    harness.tracker.move({ clientX: ORIGIN.clientX + LONG_PRESS_MOVE_TOLERANCE_PX + 1, clientY: ORIGIN.clientY });

    expect(harness.holdPending()).toBe(false);
    expect(harness.longPresses).toBe(0);
  });

  it("lets an ordinary tap through", () => {
    const harness = trackerHarness();

    harness.tracker.start(ORIGIN);
    harness.tracker.cancel();

    expect(harness.tracker.consumeSuppressedClick()).toBe(false);
  });
});

describe("the tap after a hold that was answered elsewhere", () => {
  /**
   * The bug behind "dismiss needs several taps". A completed hold arms the
   * click suppression, and it was only disarmed by a click actually arriving.
   * When the hold is answered by opening a menu, the synthetic click often
   * never reaches the row - the menu took the gesture, the finger lifted over
   * a different element, or the row re-rendered underneath. The flag then
   * outlived the gesture, and the reader's next genuine tap was spent clearing
   * it instead of doing anything. From the reader's side the control simply did
   * not respond until they tapped again.
   *
   * A press cannot suppress a click that belongs to a later press, so starting
   * the next press is what must clear it.
   */
  it("is not swallowed when a new press has begun", () => {
    const harness = trackerHarness();

    harness.tracker.start(ORIGIN);
    harness.completeHold();
    harness.tracker.cancel(); // pointerup, and no click ever came

    // The reader gives up and taps something else.
    harness.tracker.start({ clientX: 200, clientY: 200 });
    harness.tracker.cancel();

    expect(harness.tracker.consumeSuppressedClick()).toBe(false);
  });
});
