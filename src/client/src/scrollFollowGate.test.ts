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
