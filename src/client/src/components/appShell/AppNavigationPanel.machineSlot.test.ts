// @vitest-environment happy-dom

import { html } from "lit";
import { describe, expect, it } from "vitest";
import { AppNavigationPanel } from "./AppNavigationPanel";
import type { Machine } from "../../api";
import type { MachineSectionContext, MachineSectionContribution, QualifiedMachineSectionContribution } from "../../plugins/types";

function machine(id: string, kind: "local" | "remote" = "local"): Machine {
  return { id, name: id, kind, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
}

function contributedSection(rendered: string): QualifiedMachineSectionContribution {
  const section: MachineSectionContribution = {
    id: "machines",
    render: (context: MachineSectionContext) => html`<div class="contributed-machines" data-machines=${context.machines.length} data-selected=${context.selectedMachineId ?? ""}>${rendered}</div>`,
  };
  return { ...section, id: "machines:machines", pluginId: "machines", localId: "machines" };
}

function hostContext(): MachineSectionContext {
  return {
    machines: [{ id: "local", name: "Local device", kind: "local", status: "online" }],
    selectedMachineId: "local",
    machineFlags: { local: {} },
    display: { hidden: false, collapsible: false, collapsed: false, tiles: false, withCreate: false },
    requestUpdate: () => undefined,
    selectMachine: () => undefined,
    toggleCollapsed: () => undefined,
    focusPreviousSection: () => undefined,
    focusNextSection: () => undefined,
    cancelKeyboardNavigation: () => undefined,
  };
}

async function mountPanel(options: { machineSections?: readonly QualifiedMachineSectionContribution[]; machines?: Machine[] } = {}): Promise<AppNavigationPanel> {
  const panel = new AppNavigationPanel();
  panel.machines = options.machines ?? [machine("local")];
  panel.selectedMachine = machine("local");
  if (options.machineSections !== undefined) {
    panel.machineSections = options.machineSections;
    panel.machineSectionContext = hostContext();
  }
  document.body.append(panel);
  await panel.updateComplete;
  return panel;
}

describe("the machines slot", () => {
  it("renders the builtin machine list when no plugin contributes the section", async () => {
    const panel = await mountPanel();

    expect(panel.shadowRoot?.querySelector("machine-list")).not.toBeNull();
    expect(panel.shadowRoot?.querySelector(".contributed-machines")).toBeNull();
  });

  it("renders a contributed machines section in the slot instead of the builtin list", async () => {
    const panel = await mountPanel({ machineSections: [contributedSection("brought by the plugin")] });

    const contributed = panel.shadowRoot?.querySelector(".contributed-machines");
    expect(contributed).not.toBeNull();
    expect(contributed?.getAttribute("data-machines")).toBe("1");
    expect(contributed?.getAttribute("data-selected")).toBe("local");
    expect(panel.shadowRoot?.querySelector("machine-list")).toBeNull();
  });

  it("tells the contributed section the slot is hidden on the desktop body", async () => {
    const seen: boolean[] = [];
    const section: MachineSectionContribution = {
      id: "machines",
      render: (context) => {
        seen.push(context.display.hidden);
        return html`<div class="contributed-machines"></div>`;
      },
    };
    const panel = await mountPanel({ machineSections: [{ ...section, id: "machines:machines", pluginId: "machines", localId: "machines" }] });

    expect(seen).toEqual([false]);
    expect(panel.shadowRoot?.querySelector(".contributed-machines")).not.toBeNull();
  });

  it("keeps a hidden contributed section mounted so its body survives the section switch", async () => {
    const panel = await mountPanel({ machineSections: [contributedSection("kept")] });
    panel.projectsCollapsed = false;
    panel.machinesCollapsed = true;
    await panel.updateComplete;

    expect(panel.shadowRoot?.querySelector(".contributed-machines")).not.toBeNull();
  });
});
