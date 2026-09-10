import { describe, expect, it } from "vitest";
import { interruptedRunsReadPlan } from "./interruptedRunsRead";

describe("interruptedRunsReadPlan", () => {
  it("a failed read is not a record", () => {
    expect(interruptedRunsReadPlan(undefined, false)).toEqual({ failed: true, adoptMarkers: false, resolveUnknown: false });
  });

  it("a non-empty record is adopted and resolves the unknown state", () => {
    const plan = interruptedRunsReadPlan(new Set(["s1"]), false);
    expect(plan).toEqual({ failed: false, adoptMarkers: true, resolveUnknown: true });
  });

  /**
   * The recovery path the unknown banner promises: after the boot read spent
   * the record, the answer a reconnect brings is empty — and it still
   * resolves the banner. The round-25 fix cleared a flag no one read and
   * left this path behind an early return.
   */
  it("an empty post-boot read resolves the unknown banner without erasing on-screen markers", () => {
    const plan = interruptedRunsReadPlan(new Set<string>(), false);
    expect(plan).toEqual({ failed: false, adoptMarkers: false, resolveUnknown: true });
  });

  it("the boot read may adopt an empty record as a true retraction", () => {
    const plan = interruptedRunsReadPlan(new Set<string>(), true);
    expect(plan).toEqual({ failed: false, adoptMarkers: true, resolveUnknown: true });
  });
});
