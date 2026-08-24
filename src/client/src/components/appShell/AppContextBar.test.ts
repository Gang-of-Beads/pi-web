import { describe, expect, it } from "vitest";
import type { Machine } from "../../api";
import { shouldShowMachineContext } from "./AppContextBar";

describe("shouldShowMachineContext", () => {
  it("hides the machine crumb only before any machine is known", () => {
    expect(shouldShowMachineContext([])).toBe(false);
  });

  // The crumb is the mobile route to machine management: renaming this device
  // and adding another one live behind it, so one machine is enough to show it.
  it("shows the machine crumb as soon as a machine exists", () => {
    expect(shouldShowMachineContext([machine("local")])).toBe(true);
    expect(shouldShowMachineContext([machine("local"), machine("remote-a")])).toBe(true);
  });
});

function machine(id: string): Machine {
  return {
    id,
    name: id,
    kind: id === "local" ? "local" : "remote",
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
  };
}
