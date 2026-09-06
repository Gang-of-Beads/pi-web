import { html } from "lit";
import { describe, expect, it } from "vitest";
import { PluginRegistry } from "./registry";
import type { MachineSectionContribution, PiWebPlugin } from "./types";

function pluginWith(sections: MachineSectionContribution[], name = "Machines"): PiWebPlugin {
  return { apiVersion: 2, name, activate: () => ({ contributions: { machineSections: sections } }) };
}

const machines: MachineSectionContribution = {
  id: "machines",
  render: () => html`<div class="machine-list"></div>`,
};

describe("machine section contributions", () => {
  it("qualifies a contributed section for the active machine", () => {
    const registry = new PluginRegistry();
    registry.register({ id: "machines", plugin: pluginWith([machines]) });

    const sections = registry.getMachineSections("machine-1");

    expect(sections).toHaveLength(1);
    expect(sections[0]?.id).toBe("machines:machines");
    expect(sections[0]?.localId).toBe("machines");
  });

  it("reports none while no machine is selected", () => {
    const registry = new PluginRegistry();
    registry.register({ id: "machines", plugin: pluginWith([machines]) });

    expect(registry.getMachineSections(undefined)).toEqual([]);
  });

  it("sorts by order then local id", () => {
    const registry = new PluginRegistry();
    registry.register({
      id: "many",
      plugin: pluginWith([
        { ...machines, id: "zeta", order: 1 },
        { ...machines, id: "beta" },
        { ...machines, id: "alpha" },
      ]),
    });

    expect(registry.getMachineSections("machine-1").map((section) => section.localId)).toEqual(["zeta", "alpha", "beta"]);
  });

  it("scopes a machine-bound section to its own machine", () => {
    const registry = new PluginRegistry();
    registry.register({ id: "remote-machines", sourcePluginId: "machines", machineId: "remote-1", plugin: pluginWith([machines]), machineSpecific: true });

    expect(registry.getMachineSections("remote-1")).toHaveLength(1);
    expect(registry.getMachineSections("other")).toEqual([]);
  });

  it("rejects a duplicate id within one registration", () => {
    const registry = new PluginRegistry();

    expect(() => { registry.register({ id: "machines", plugin: pluginWith([machines, machines]) }); }).toThrow(/Duplicate contribution id/);
  });

  it("takes the section off the surface when the plugin is disposed", () => {
    const registry = new PluginRegistry();
    registry.register({ id: "machines", plugin: pluginWith([machines]) });

    registry.disposePlugin("machines");

    expect(registry.getMachineSections("machine-1")).toEqual([]);
  });
});
