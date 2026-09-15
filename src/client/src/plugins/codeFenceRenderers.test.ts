import { describe, expect, it } from "vitest";
import { PluginRegistry } from "./registry";
import type { CodeFenceRendererContribution, PiWebPlugin } from "./types";

function fencePlugin(name: string, renderers: CodeFenceRendererContribution[]): PiWebPlugin {
  return { apiVersion: 2, name, activate: () => ({ contributions: { codeFenceRenderers: renderers } }) };
}

const mermaid: CodeFenceRendererContribution = {
  id: "mermaid",
  language: "Mermaid",
  render: () => document.createElement("div"),
};

describe("code fence renderer contributions", () => {
  it("finds the renderer that claims a language, case-folded on both sides", () => {
    const registry = new PluginRegistry();
    registry.register({ id: "diagrams", plugin: fencePlugin("Diagrams", [mermaid]) });

    const found = registry.findCodeFenceRenderer("MERMAID", "machine-1");

    expect(found?.id).toBe("diagrams:mermaid");
    expect(found?.language).toBe("mermaid");
  });

  it("answers undefined for an unclaimed language and while no machine is selected", () => {
    const registry = new PluginRegistry();
    registry.register({ id: "diagrams", plugin: fencePlugin("Diagrams", [mermaid]) });

    expect(registry.findCodeFenceRenderer("plantuml", "machine-1")).toBeUndefined();
    expect(registry.findCodeFenceRenderer("mermaid", undefined)).toBeUndefined();
  });

  it("refuses a second claim on the same language and a blank language", () => {
    const registry = new PluginRegistry();
    registry.register({ id: "diagrams", plugin: fencePlugin("Diagrams", [mermaid]) });

    expect(() => {
      registry.register({ id: "other", plugin: fencePlugin("Other", [{ ...mermaid, id: "mine" }]) });
    }).toThrow(/already rendered by diagrams:mermaid/u);
    expect(() => {
      new PluginRegistry().register({ id: "twice", plugin: fencePlugin("Twice", [mermaid, { ...mermaid, id: "again" }]) });
    }).toThrow(/claimed twice by twice/u);
    expect(() => {
      registry.register({ id: "blank", plugin: fencePlugin("Blank", [{ ...mermaid, id: "blank", language: "  " }]) });
    }).toThrow(/names no language/u);
  });

  it("scopes a machine-bound renderer to its machine and releases the claim on unregister", () => {
    const registry = new PluginRegistry();
    registry.register({ id: "remote-diagrams", sourcePluginId: "diagrams", machineId: "remote-1", plugin: fencePlugin("Diagrams", [mermaid]), machineSpecific: true });

    expect(registry.findCodeFenceRenderer("mermaid", "remote-1")?.localId).toBe("mermaid");
    expect(registry.findCodeFenceRenderer("mermaid", "other-machine")).toBeUndefined();

    registry.disposePlugin("remote-diagrams");
    expect(registry.findCodeFenceRenderer("mermaid", "remote-1")).toBeUndefined();
  });
});
