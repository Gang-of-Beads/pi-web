import { describe, expect, it } from "vitest";

import { ScrollFollowGate } from "./scrollFollowGate";

const TOUCH_SETTLE_MS = 250;

describe("following the newest message while a reader is touching the transcript", () => {
  /**
   * A reply appends below the cards already on screen, and following the
   * newest message pulls them upward each frame. A reader aiming at Dismiss
   * therefore watched the button leave from under a finger already on its way
   * down, and reported clicking many times before it went away.
   */
  it("stops following while a finger is down", () => {
    const gate = new ScrollFollowGate();

    expect(gate.followsNewest(0)).toBe(true);

    gate.notePointerDown(0);

    expect(gate.followsNewest(10)).toBe(false);
  });

  it("keeps holding briefly after release so the tap can land", () => {
    const gate = new ScrollFollowGate();
    gate.notePointerDown(0);
    gate.notePointerUp(100);

    expect(gate.followsNewest(100 + TOUCH_SETTLE_MS - 1)).toBe(false);
    expect(gate.followsNewest(100 + TOUCH_SETTLE_MS)).toBe(true);
  });

  it("resumes following once a stuck pointer outlives any real touch", () => {
    const gate = new ScrollFollowGate();
    gate.notePointerDown(0);

    expect(gate.followsNewest(30_000)).toBe(true);
  });
});

/**
 * Suppressing the scroll is only half of not moving content under a finger. A
 * keyboard opening mid-press grows the scrollable range, and the request to
 * follow it was dropped rather than deferred: measured on a phone viewport, a
 * reader pinned at 27612 of 27612 was left at 27612 of 27948 after release,
 * 336px short of the bottom they were pinned to.
 */
describe("applying the follow that was suppressed during a press", () => {
  it("reports nothing to catch up on when no follow was suppressed", () => {
    const gate = new ScrollFollowGate();
    gate.notePointerDown(0);
    gate.notePointerUp(100);

    expect(gate.takeSuppressedFollow()).toBe(false);
  });

  it("remembers a follow refused while a finger was down", () => {
    const gate = new ScrollFollowGate();
    gate.notePointerDown(0);

    expect(gate.followsNewest(10)).toBe(false);

    gate.notePointerUp(100);

    expect(gate.takeSuppressedFollow()).toBe(true);
  });

  it("reports the suppressed follow once, so a later release does not re-scroll a reader who left the bottom", () => {
    const gate = new ScrollFollowGate();
    gate.notePointerDown(0);
    gate.followsNewest(10);
    gate.notePointerUp(100);

    expect(gate.takeSuppressedFollow()).toBe(true);
    expect(gate.takeSuppressedFollow()).toBe(false);
  });

  it("drops the suppressed follow when a stuck pointer already let following resume", () => {
    const gate = new ScrollFollowGate();
    gate.notePointerDown(0);

    expect(gate.followsNewest(30_000)).toBe(true);

    gate.notePointerUp(30_100);

    expect(gate.takeSuppressedFollow()).toBe(false);
  });
});
