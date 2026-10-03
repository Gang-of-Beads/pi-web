import { describe, expect, it } from "vitest";
import { holdAfterFailure, isHeld, PAGE_RETRY_OPEN, releaseHold, type PageRetry } from "./pageRetry.js";

describe("a failed page read's hold (D4, review ca45d6ed)", () => {
  it("waits on the read ladder, doubling up to the quiet window, while the failures go on", () => {
    let retry: PageRetry = PAGE_RETRY_OPEN;
    const waits: number[] = [];
    for (let failure = 0; failure < 6; failure += 1) {
      const held = holdAfterFailure(retry);
      waits.push(held.waitMs);
      retry = releaseHold(held);
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000, 15_000, 15_000]);
  });

  /** Review 754821b2: a hold that ended by the wall clock could outlive its timer when the clock stepped back. */
  it("holds until its timer releases it, whatever the clock says, and a released hold remembers its failures", () => {
    const held = holdAfterFailure(PAGE_RETRY_OPEN);
    const released = releaseHold(held);
    expect({
      open: isHeld(PAGE_RETRY_OPEN),
      held: isHeld(held),
      released: isHeld(released),
      next: holdAfterFailure(released).waitMs,
      openStaysOpen: releaseHold(PAGE_RETRY_OPEN),
    }).toEqual({ open: false, held: true, released: false, next: 2000, openStaysOpen: PAGE_RETRY_OPEN });
  });
});
