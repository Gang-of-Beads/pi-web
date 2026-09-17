// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { QuickSwitcher } from "./QuickSwitcher";
import type { Machine } from "../api";

afterEach(() => {
  document.body.replaceChildren();
});

/**
 * One tab per machine at the top of the switcher; tapping one browses that
 * machine's sessions without leaving the sheet. With a single machine there
 * is no choice to make and no tabs to show.
 */
function machine(id: string, name: string): Machine {
  const now = new Date().toISOString();
  return { id, name, baseUrl: `https://${id}.example.test`, kind: "remote", createdAt: now, updatedAt: now };
}

async function mountWithMachines(machines: Machine[], browseMachineId: string, onSelectMachine?: (machineId: string) => void): Promise<QuickSwitcher> {
  const switcher = new QuickSwitcher();
  switcher.sessions = [];
  switcher.machines = machines;
  switcher.browseMachineId = browseMachineId;
  if (onSelectMachine !== undefined) switcher.onSelectMachine = onSelectMachine;
  document.body.append(switcher);
  await switcher.updateComplete;
  return switcher;
}

function machineCrumb(switcher: QuickSwitcher): HTMLButtonElement | undefined {
  return Array.from(switcher.shadowRoot?.querySelectorAll<HTMLButtonElement>(".crumb") ?? [])[0];
}

async function machineOptions(switcher: QuickSwitcher): Promise<HTMLButtonElement[]> {
  machineCrumb(switcher)?.click();
  await switcher.updateComplete;
  return Array.from(switcher.shadowRoot?.querySelectorAll<HTMLButtonElement>(".crumb-option") ?? []);
}

describe("the switcher's machine tabs", () => {
  it("names the browsed machine on the path and lists the others as options", async () => {
    const switcher = await mountWithMachines([machine("local", "Local"), machine("pi", "hxd-pi")], "pi");
    expect(machineCrumb(switcher)?.textContent.trim()).toBe("hxd-pi");
    const options = await machineOptions(switcher);
    expect(options.map((option) => (option.querySelector(".crumb-option-label") ?? option).textContent.trim())).toEqual(["Local", "hxd-pi"]);
    expect(options.map((option) => option.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
  });

  it("omits the machine level when there is only one machine", async () => {
    const solo = await mountWithMachines([machine("local", "Local")], "local");
    expect(machineCrumb(solo)).toBeUndefined();
  });

  it("reports the chosen machine to its host", async () => {
    const onSelectMachine = vi.fn<(machineId: string) => void>();
    const switcher = await mountWithMachines([machine("local", "Local"), machine("pi", "hxd-pi")], "local", onSelectMachine);
    const options = await machineOptions(switcher);
    options[1]?.click();
    expect(onSelectMachine).toHaveBeenCalledExactlyOnceWith("pi");
  });

  it("keeps every path control on the touch floor", () => {
    const sheet = String(QuickSwitcher.styles);
    expect(sheet).toMatch(/\.crumb-option\s*\{[^}]*min-height: var\(--pi-control-height-comfort\)/u);
  });
});
