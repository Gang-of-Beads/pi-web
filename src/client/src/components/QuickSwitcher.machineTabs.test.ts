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
  return { id, name, baseUrl: `https://${id}.example.test`, kind: "remote" } as unknown as Machine;
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

function tabs(switcher: QuickSwitcher): HTMLButtonElement[] {
  return Array.from(switcher.shadowRoot?.querySelectorAll(".machine-tab") ?? []);
}

describe("the switcher's machine tabs", () => {
  it("shows a tab per machine and marks the browsed one", async () => {
    const switcher = await mountWithMachines([machine("local", "Local"), machine("pi", "hxd-pi")], "pi");
    const rendered = tabs(switcher);
    expect(rendered.map((tab) => tab.textContent?.trim())).toEqual(["Local", "hxd-pi"]);
    expect(rendered.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true"]);
  });

  it("shows no tabs when there is only one machine", async () => {
    const switcher = await mountWithMachines([machine("local", "Local")], "local");
    expect(tabs(switcher)).toHaveLength(0);
  });

  it("reports the tapped machine to its host", async () => {
    const onSelectMachine = vi.fn<(machineId: string) => void>();
    const switcher = await mountWithMachines([machine("local", "Local"), machine("pi", "hxd-pi")], "local", onSelectMachine);
    tabs(switcher)[1]?.click();
    expect(onSelectMachine).toHaveBeenCalledExactlyOnceWith("pi");
  });

  it("keeps every tab on the touch floor", async () => {
    const switcher = await mountWithMachines([machine("local", "Local"), machine("pi", "hxd-pi")], "local");
    const sheet = String(QuickSwitcher.styles);
    expect(sheet).toMatch(/\.machine-tab\s*\{[^}]*min-height: 36px/u);
  });
});
