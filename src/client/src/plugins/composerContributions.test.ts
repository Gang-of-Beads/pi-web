import { describe, expect, it, vi } from "vitest";
import { PluginRegistry } from "./registry";
import type { ComposerContribution, PiWebPlugin } from "./types";

function pluginWith(composer: ComposerContribution[]): PiWebPlugin {
  return {
    apiVersion: 2,
    name: "Test voice",
    activate: () => ({ contributions: { composer } }),
  };
}

const dictate: ComposerContribution = {
  id: "dictate",
  slot: "trailing",
  title: "Dictate",
  run: vi.fn(),
};

describe("composer contributions", () => {
  it("qualifies ids and reports the contribution for the active machine", () => {
    const registry = new PluginRegistry();
    registry.register({ id: "voice", plugin: pluginWith([dictate]) });

    const contributions = registry.getComposerContributions("machine-1");

    expect(contributions).toHaveLength(1);
    expect(contributions[0]?.id).toBe("voice:dictate");
    expect(contributions[0]?.pluginId).toBe("voice");
    expect(contributions[0]?.localId).toBe("dictate");
    expect(contributions[0]?.slot).toBe("trailing");
  });

  it("orders contributions by order then title", () => {
    const registry = new PluginRegistry();
    registry.register({
      id: "many",
      plugin: pluginWith([
        { ...dictate, id: "zeta", title: "Zeta", order: 1 },
        { ...dictate, id: "beta", title: "Beta" },
        { ...dictate, id: "alpha", title: "Alpha" },
      ]),
    });

    const titles = registry.getComposerContributions("machine-1").map((entry) => entry.title);

    expect(titles).toEqual(["Zeta", "Alpha", "Beta"]);
  });

  it("returns nothing while no machine is selected", () => {
    const registry = new PluginRegistry();
    registry.register({ id: "voice", plugin: pluginWith([dictate]) });

    expect(registry.getComposerContributions(undefined)).toEqual([]);
  });

  it("scopes a machine-bound contribution to its machine", () => {
    const registry = new PluginRegistry();
    registry.register({ id: "gateway-voice", sourcePluginId: "voice", machineId: "remote-1", plugin: pluginWith([dictate]), machineSpecific: true });

    expect(registry.getComposerContributions("remote-1")).toHaveLength(1);
    expect(registry.getComposerContributions("other-machine")).toEqual([]);
  });

  it("rejects duplicate contribution ids inside one plugin", () => {
    const registry = new PluginRegistry();

    expect(() => {
      registry.register({ id: "voice", plugin: pluginWith([dictate, { ...dictate }]) });
    }).toThrow(/voice:dictate/u);
  });
});
