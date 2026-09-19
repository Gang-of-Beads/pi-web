import { describe, expect, it } from "vitest";
import { goalEventSummary } from "./goalEventSummary";

describe("goalEventSummary", () => {
  it("names the kind of goal event", () => {
    expect(goalEventSummary("pi-goal-audit-event", {}).title).toBe("Goal audit");
    expect(goalEventSummary("pi-goal-focus", {}).title).toBe("Goal focus");
    expect(goalEventSummary("pi-goal-unknown-thing", {}).title).toBe("Goal event");
  });

  it("reads the phase, the auditor and the goal it is about", () => {
    expect(goalEventSummary("pi-goal-audit-event", { phase: "start", auditor: "opus", goalId: "g1" }).detail)
      .toBe("started · opus · g1");
  });

  it("falls back to the first line of the message rather than saying nothing", () => {
    expect(goalEventSummary("pi-goal-guard", undefined, "Goal changed while confirming; nothing was cleared.\nsecond line").detail)
      .toBe("Goal changed while confirming; nothing was cleared.");
  });

  it("says nothing when there is nothing to say", () => {
    expect(goalEventSummary("pi-goal-focus", undefined, "").detail).toBeUndefined();
  });
});
