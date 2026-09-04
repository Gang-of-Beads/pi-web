import { describe, expect, it, vi } from "vitest";
import { PluginRegistry } from "./registry";
import type { PiWebPlugin, PluginSettings } from "./types";

function settingsAwarePlugin(seen: (PluginSettings | undefined)[]): PiWebPlugin {
  return {
    apiVersion: 2,
    name: "Voice",
    activate: (context) => {
      seen.push(context.settings);
      context.on?.("settings-changed", (event) => { seen.push(event.settings); });
      return { contributions: {} };
    },
  };
}

describe("plugin settings delivery", () => {
  it("hands a plugin its own configuration at activation", () => {
    const seen: (PluginSettings | undefined)[] = [];
    const registry = new PluginRegistry();

    registry.register({ id: "voice", plugin: settingsAwarePlugin(seen), settings: { region: "eastus" } });

    expect(seen).toEqual([{ region: "eastus" }]);
    expect(registry.pluginSettings("voice")).toEqual({ region: "eastus" });
  });

  it("reports undefined rather than empty for an unconfigured plugin", () => {
    const seen: (PluginSettings | undefined)[] = [];
    const registry = new PluginRegistry();

    registry.register({ id: "voice", plugin: settingsAwarePlugin(seen) });

    expect(seen).toEqual([undefined]);
    expect(registry.pluginSettings("voice")).toBeUndefined();
  });

  it("notifies only the plugin whose configuration changed", () => {
    const voiceSeen: (PluginSettings | undefined)[] = [];
    const goalsSeen: (PluginSettings | undefined)[] = [];
    const registry = new PluginRegistry();
    registry.register({ id: "voice", plugin: settingsAwarePlugin(voiceSeen), settings: { region: "eastus" } });
    registry.register({ id: "goals", plugin: settingsAwarePlugin(goalsSeen), settings: { autoContinue: true } });

    registry.applyPluginSettings("voice", { region: "westus" });

    expect(voiceSeen).toEqual([{ region: "eastus" }, { region: "westus" }]);
    expect(goalsSeen).toEqual([{ autoContinue: true }]);
    expect(registry.pluginSettings("voice")).toEqual({ region: "westus" });
  });

  it("keeps the host alive when a settings listener throws", () => {
    const registry = new PluginRegistry();
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      registry.register({
        id: "thrower",
        plugin: {
          apiVersion: 2,
          name: "Thrower",
          activate: (context) => {
            context.on?.("settings-changed", () => { throw new Error("boom"); });
            return { contributions: {} };
          },
        },
      });

      expect(() => { registry.applyPluginSettings("thrower", { any: 1 }); }).not.toThrow();
      expect(registry.pluginSettings("thrower")).toEqual({ any: 1 });
    } finally {
      errors.mockRestore();
    }
  });

  it("forgets a disposed plugin's configuration", () => {
    const seen: (PluginSettings | undefined)[] = [];
    const registry = new PluginRegistry();
    registry.register({ id: "voice", plugin: settingsAwarePlugin(seen), settings: { region: "eastus" } });

    registry.disposePlugin("voice");

    expect(registry.pluginSettings("voice")).toBeUndefined();
  });
});
