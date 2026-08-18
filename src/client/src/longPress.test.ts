import { describe, expect, it, vi } from "vitest";
import { LONG_PRESS_MOVE_TOLERANCE_PX, LONG_PRESS_MS, LongPressTracker } from "./longPress";

function tracker() {
  const timers = new Map<number, () => void>();
  let nextHandle = 1;
  const onLongPress = vi.fn();
  const instance = new LongPressTracker({
    onLongPress,
    setTimer: (callback) => { const handle = nextHandle++; timers.set(handle, callback); return handle; },
    clearTimer: (handle) => { timers.delete(handle); },
  });
  return { instance, onLongPress, fireTimers: () => { for (const run of [...timers.values()]) run(); timers.clear(); } };
}

describe("long press", () => {
  it("fires after the hold and suppresses the click that follows", () => {
    const { instance, onLongPress, fireTimers } = tracker();
    instance.start({ clientX: 100, clientY: 200 });
    fireTimers();

    expect(onLongPress).toHaveBeenCalledOnce();
    // Otherwise the browser's synthetic click opens the very session the user
    // was holding in order to select it.
    expect(instance.consumeSuppressedClick()).toBe(true);
    // ...and only that one click: an ordinary tap afterwards must still work.
    expect(instance.consumeSuppressedClick()).toBe(false);
  });

  it("does not fire when the finger drifts, so scrolling stays scrolling", () => {
    const { instance, onLongPress, fireTimers } = tracker();
    instance.start({ clientX: 100, clientY: 200 });
    instance.move({ clientX: 100, clientY: 200 + LONG_PRESS_MOVE_TOLERANCE_PX + 1 });
    fireTimers();

    expect(onLongPress).not.toHaveBeenCalled();
    expect(instance.consumeSuppressedClick()).toBe(false);
  });

  it("tolerates the small drift of a finger that is meant to be still", () => {
    const { instance, onLongPress, fireTimers } = tracker();
    instance.start({ clientX: 100, clientY: 200 });
    instance.move({ clientX: 100 + LONG_PRESS_MOVE_TOLERANCE_PX, clientY: 200 });
    fireTimers();

    expect(onLongPress).toHaveBeenCalledOnce();
  });

  it("does not fire for a press released early", () => {
    const { instance, onLongPress, fireTimers } = tracker();
    instance.start({ clientX: 10, clientY: 10 });
    instance.cancel();
    fireTimers();

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("holds for long enough not to trigger during a flick", () => {
    // A guard on the constant itself: shortening it is what would make the
    // gesture fire while someone is scrolling the list.
    expect(LONG_PRESS_MS).toBeGreaterThanOrEqual(400);
  });
});
