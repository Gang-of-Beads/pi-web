import { html } from "lit";
import { describe, expect, it } from "vitest";
import { PluginRegistry } from "./registry";
import type { DrawerSectionContribution, PiWebPlugin } from "./types";

function pluginWith(sections: DrawerSectionContribution[], name = "Goals"): PiWebPlugin {
  return { apiVersion: 2, name, activate: () => ({ contributions: { drawerSections: sections } }) };
}

const goals: DrawerSectionContribution = {
  id: "goals",
  title: "Goals",
  render: () => html`<div class="goal-list"></div>`,
};

describe("drawer section contributions", () => {
  it("qualifies a contributed section for the active machine", () => {
    const registry = new PluginRegistry();
    registry.register({ id: "goals", plugin: pluginWith([goals]) });

    const sections = registry.getDrawerSections("machine-1");

    expect(sections).toHaveLength(1);
    expect(sections[0]?.id).toBe("goals:goals");
    expect(sections[0]?.title).toBe("Goals");
  });

  it("reports none while no machine is selected", () => {
    const registry = new PluginRegistry();
    registry.register({ id: "goals", plugin: pluginWith([goals]) });

    expect(registry.getDrawerSections(undefined)).toEqual([]);
  });

  it("orders sections by order then title", () => {
    const registry = new PluginRegistry();
    registry.register({
      id: "many",
      plugin: pluginWith([
        { ...goals, id: "zeta", title: "Zeta", order: 1 },
        { ...goals, id: "beta", title: "Beta" },
        { ...goals, id: "alpha", title: "Alpha" },
      ]),
    });

    expect(registry.getDrawerSections("machine-1").map((section) => section.title)).toEqual(["Zeta", "Alpha", "Beta"]);
  });

  it("scopes a machine-bound section to its own machine", () => {
    const registry = new PluginRegistry();
    registry.register({ id: "remote-goals", sourcePluginId: "goals", machineId: "remote-1", plugin: pluginWith([goals]), machineSpecific: true });

    expect(registry.getDrawerSections("remote-1")).toHaveLength(1);
    expect(registry.getDrawerSections("other")).toEqual([]);
  });

  it("takes a disposed plugin's sections off the drawer", () => {
    const registry = new PluginRegistry();
    registry.register({ id: "goals", plugin: pluginWith([goals]) });

    registry.disposePlugin("goals");

    expect(registry.getDrawerSections("machine-1")).toEqual([]);
  });

  it("refuses a duplicate section id inside one plugin", () => {
    const registry = new PluginRegistry();

    expect(() => { registry.register({ id: "goals", plugin: pluginWith([goals, { ...goals }]) }); }).toThrow(/goals:goals/u);
  });
});
