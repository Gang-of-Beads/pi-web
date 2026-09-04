import { html } from "lit";
import { describe, expect, it } from "vitest";
import { PluginRegistry } from "./registry";
import type { MessageRendererContribution, PiWebPlugin } from "./types";

function rendererPlugin(name: string, renderers: MessageRendererContribution[]): PiWebPlugin {
  return { apiVersion: 2, name, activate: () => ({ contributions: { messageRenderers: renderers } }) };
}

const pollRenderer: MessageRendererContribution = {
  id: "poll",
  tag: "poll",
  render: () => html`<div>poll</div>`,
};

describe("message renderer contributions", () => {
  it("finds the renderer that claims a tag", () => {
    const registry = new PluginRegistry();
    registry.register({ id: "polls", plugin: rendererPlugin("Polls", [pollRenderer]) });

    const found = registry.findMessageRenderer("poll", "machine-1");

    expect(found?.id).toBe("polls:poll");
    expect(found?.pluginId).toBe("polls");
  });

  it("answers undefined for an unclaimed tag so the transcript can be honest", () => {
    const registry = new PluginRegistry();
    registry.register({ id: "polls", plugin: rendererPlugin("Polls", [pollRenderer]) });

    expect(registry.findMessageRenderer("chart", "machine-1")).toBeUndefined();
  });

  it("answers undefined while no machine is selected", () => {
    const registry = new PluginRegistry();
    registry.register({ id: "polls", plugin: rendererPlugin("Polls", [pollRenderer]) });

    expect(registry.findMessageRenderer("poll", undefined)).toBeUndefined();
  });

  it("refuses a second claim on the same tag instead of silently overriding", () => {
    const registry = new PluginRegistry();
    registry.register({ id: "polls", plugin: rendererPlugin("Polls", [pollRenderer]) });

    expect(() => {
      registry.register({ id: "other", plugin: rendererPlugin("Other", [{ ...pollRenderer, id: "mine" }]) });
    }).toThrow(/already rendered by polls:poll/u);
  });

  it("scopes a machine-bound renderer to its machine", () => {
    const registry = new PluginRegistry();
    registry.register({ id: "remote-polls", sourcePluginId: "polls", machineId: "remote-1", plugin: rendererPlugin("Polls", [pollRenderer]), machineSpecific: true });

    expect(registry.findMessageRenderer("poll", "remote-1")?.localId).toBe("poll");
    expect(registry.findMessageRenderer("poll", "other-machine")).toBeUndefined();
  });
});
