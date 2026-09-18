import { describe, expect, it, vi } from "vitest";
import { ScrollThumbVisibility, SCROLL_THUMB_LINGER_MS } from "./scrollActivity";

function harness() {
  const changes: boolean[] = [];
  let pending: (() => void) | undefined;
  let cleared = 0;
  const visibility = new ScrollThumbVisibility((visible) => { changes.push(visible); }, {
    setTimer: (callback) => { pending = callback; return 1 as unknown as ReturnType<typeof setTimeout>; },
    clearTimer: () => { cleared += 1; },
  });
  return { visibility, changes, fire: () => { const run = pending; pending = undefined; run?.(); }, cleared: () => cleared };
}

describe("ScrollThumbVisibility", () => {
  it("shows the thumb on the first scroll and reports it once", () => {
    const { visibility, changes } = harness();
    visibility.noteScroll();
    visibility.noteScroll();
    expect(changes).toEqual([true]);
  });

  it("retires the thumb after the scrolling stops", () => {
    const { visibility, changes, fire } = harness();
    visibility.noteScroll();
    fire();
    expect(changes).toEqual([true, false]);
  });

  it("restarts the retirement while scrolling continues", () => {
    const { visibility, cleared } = harness();
    visibility.noteScroll();
    visibility.noteScroll();
    expect(cleared()).toBe(1);
  });

  it("leaves nothing running when the scroller goes away", () => {
    const { visibility, changes, cleared } = harness();
    visibility.noteScroll();
    visibility.dispose();
    expect(changes).toEqual([true, false]);
    expect(cleared()).toBe(1);
  });

  it("keeps a linger long enough to survive a flick", () => {
    expect(SCROLL_THUMB_LINGER_MS).toBeGreaterThanOrEqual(500);
  });
});
