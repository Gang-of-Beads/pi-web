import { describe, expect, it } from "vitest";
import { acceptsOptionChange, ASK_STEP_GUARD_MS } from "./askStepGuard";

describe("acceptsOptionChange", () => {
  it("accepts a change when no step has moved", () => {
    expect(acceptsOptionChange({ now: 1_000, stepChangedAt: undefined })).toBe(true);
  });

  it("refuses the tail of the gesture that moved the step", () => {
    expect(acceptsOptionChange({ now: 1_000, stepChangedAt: 1_000 })).toBe(false);
    expect(acceptsOptionChange({ now: 1_000 + ASK_STEP_GUARD_MS - 1, stepChangedAt: 1_000 })).toBe(false);
  });

  it("accepts a deliberate answer once the window passes", () => {
    expect(acceptsOptionChange({ now: 1_000 + ASK_STEP_GUARD_MS, stepChangedAt: 1_000 })).toBe(true);
  });

  it("keeps the window short enough not to swallow a quick reader", () => {
    expect(ASK_STEP_GUARD_MS).toBeLessThanOrEqual(400);
  });
});
