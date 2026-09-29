import { describe, expect, it } from "vitest";
import { statusReadVerdict } from "./statusOrder";

describe("a status read against the last applied status frame", () => {
  it("is stale when it was computed before the frame, in the same seq space", () => {
    expect(statusReadVerdict({ position: { seq: 10, epoch: "d.1" }, frameAppliedWhileReading: true }, { seq: 11, epoch: "d.1" })).toBe("stale");
  });

  it("applies when it was computed at or after the frame", () => {
    expect({
      same: statusReadVerdict({ position: { seq: 11, epoch: "d.1" }, frameAppliedWhileReading: true }, { seq: 11, epoch: "d.1" }),
      later: statusReadVerdict({ position: { seq: 12, epoch: "d.1" }, frameAppliedWhileReading: true }, { seq: 11, epoch: "d.1" }),
    }).toEqual({ same: "apply", later: "apply" });
  });

  it("applies when it belongs to another seq space, or nothing was applied yet", () => {
    expect({
      otherEpoch: statusReadVerdict({ position: { seq: 2, epoch: "d.2" }, frameAppliedWhileReading: true }, { seq: 11, epoch: "d.1" }),
      nothingApplied: statusReadVerdict({ position: { seq: 2, epoch: "d.1" }, frameAppliedWhileReading: false }, undefined),
    }).toEqual({ otherEpoch: "apply", nothingApplied: "apply" });
  });

  it("without a position, is stale exactly when a status frame was applied while it was in flight", () => {
    expect({
      frameMeanwhile: statusReadVerdict({ position: undefined, frameAppliedWhileReading: true }, { seq: 11 }),
      quiet: statusReadVerdict({ position: undefined, frameAppliedWhileReading: false }, { seq: 11 }),
    }).toEqual({ frameMeanwhile: "stale", quiet: "apply" });
  });
});
