import { describe, expect, it } from "vitest";
import { scrollbarWidthOf } from "./scrollbarWidth";

describe("how much room the scrollbar takes", () => {
  /**
   * A control pinned to the right edge of the conversation was placed a fixed
   * distance from the panel, which ignored the scrollbar entirely. On a machine
   * that draws a real scrollbar the control landed on top of it; here, where
   * the scrollbar is an overlay, it measured zero and looked correct.
   *
   * Measuring it is the difference between the two.
   */
  it("is the gap between the box and what fits inside it", () => {
    expect(scrollbarWidthOf({ offsetWidth: 800, clientWidth: 785 })).toBe(15);
  });

  it("is nothing when the scrollbar floats over the content", () => {
    expect(scrollbarWidthOf({ offsetWidth: 800, clientWidth: 800 })).toBe(0);
  });

  /**
   * A detached or unmeasured element reports zeros, and a negative gap is not
   * a scrollbar.
   */
  it("never reports a negative width", () => {
    expect(scrollbarWidthOf({ offsetWidth: 0, clientWidth: 20 })).toBe(0);
    expect(scrollbarWidthOf(undefined)).toBe(0);
  });
});
