import { describe, expect, it } from "vitest";
import { holdAfterFailure, isHeld, PAGE_RETRY_OPEN, type PageRetry } from "./pageRetry.js";

describe("a failed page read's hold (D4, review ca45d6ed)", () => {
  it("waits on the read ladder, doubling up to the quiet window", () => {
    let retry: PageRetry = PAGE_RETRY_OPEN;
    const waits: number[] = [];
    for (let failure = 0; failure < 6; failure += 1) {
      const held = holdAfterFailure(retry, 1000);
      waits.push(held.until - 1000);
      retry = held;
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000, 15_000, 15_000]);
  });

  it("holds until its time and not after, and an open retry holds nothing", () => {
    const held = holdAfterFailure(PAGE_RETRY_OPEN, 5000);
    expect({ open: isHeld(PAGE_RETRY_OPEN, 5000), before: isHeld(held, 5999), at: isHeld(held, 6000) }).toEqual({ open: false, before: true, at: false });
  });
});
