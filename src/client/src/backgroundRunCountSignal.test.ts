import { describe, expect, it } from "vitest";
import { backgroundRunCountChanged } from "./backgroundRunCountSignal.js";

describe("when the activity list must be re-read", () => {
  it("fires when the first task starts", () => {
    expect(backgroundRunCountChanged({ hadPreviousStatus: true, previousCount: 0, currentCount: 1 })).toBe(true);
  });

  it("fires when the last task finishes and the field is omitted", () => {
    expect(backgroundRunCountChanged({ hadPreviousStatus: true, previousCount: 1, currentCount: undefined })).toBe(true);
  });

  it("fires when a second task starts", () => {
    expect(backgroundRunCountChanged({ hadPreviousStatus: true, previousCount: 1, currentCount: 2 })).toBe(true);
  });

  it("stays quiet when the count is unchanged", () => {
    expect(backgroundRunCountChanged({ hadPreviousStatus: true, previousCount: 2, currentCount: 2 })).toBe(false);
  });

  it("treats an omitted count and zero as the same fact", () => {
    expect(backgroundRunCountChanged({ hadPreviousStatus: true, previousCount: undefined, currentCount: 0 })).toBe(false);
    expect(backgroundRunCountChanged({ hadPreviousStatus: true, previousCount: 0, currentCount: undefined })).toBe(false);
  });

  it("does not fire on the first status frame, which establishes the baseline", () => {
    expect(backgroundRunCountChanged({ hadPreviousStatus: false, previousCount: undefined, currentCount: 3 })).toBe(false);
  });
});
