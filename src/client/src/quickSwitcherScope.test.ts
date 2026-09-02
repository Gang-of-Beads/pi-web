import { describe, expect, it } from "vitest";
import { quickSwitcherScope } from "./quickSwitcherScope.js";

/**
 * Quick access fetches one machine's sessions at a time, so the list it holds
 * belongs to the machine it was fetched for. A machine tab that changes faster
 * than the read lands must not put the previous machine's sessions under the
 * new machine's name: that offers the reader sessions which are not there.
 */

describe("which machine's sessions quick access may draw", () => {
  it("draws the list when it was fetched for the machine on screen", () => {
    expect(quickSwitcherScope({ tabMachineId: "m1", cachedMachineId: "m1", loading: false })).toEqual({ state: "ready", machineId: "m1" });
  });

  /** The wrong-machine case: a list in hand, but for somebody else. */
  it("refuses a list fetched for a different machine", () => {
    expect(quickSwitcherScope({ tabMachineId: "m2", cachedMachineId: "m1", loading: false })).toEqual({ state: "other-machine", machineId: "m2", cachedFor: "m1" });
  });

  it("reports loading while the first read for a machine is in flight", () => {
    expect(quickSwitcherScope({ tabMachineId: "m1", cachedMachineId: undefined, loading: true }).state).toBe("loading");
  });

  /**
   * Never fetched is not the same as fetched and empty. Without a cached
   * machine there is nothing to claim about this machine's sessions yet.
   */
  it("does not call an unfetched machine ready", () => {
    expect(quickSwitcherScope({ tabMachineId: "m1", cachedMachineId: undefined, loading: false }).state).toBe("loading");
  });

  it("keeps refusing the stale list while the new read is in flight", () => {
    expect(quickSwitcherScope({ tabMachineId: "m2", cachedMachineId: "m1", loading: true }).state).toBe("other-machine");
  });
});
