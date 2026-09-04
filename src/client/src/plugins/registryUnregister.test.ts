import { html } from "lit";
import { describe, expect, it, vi } from "vitest";
import { PluginRegistry } from "./registry";
import type { PiWebPlugin, PluginLifecycleEvent } from "./types";

function fullPlugin(seen: PluginLifecycleEvent[]): PiWebPlugin {
  return {
    apiVersion: 2,
    name: "Voice",
    activate: (context) => {
      context.on?.("session-selected", (event) => { seen.push(event); });
      return {
        contributions: {
          composer: [{ id: "dictate", slot: "trailing", title: "Dictate", run: () => undefined }],
          settingsSections: [{ id: "voice", title: "Voice", render: () => html`<div></div>` }],
          messageRenderers: [{ id: "poll", tag: "poll", render: () => html`<div></div>` }],
        },
      };
    },
  };
}

describe("unregistering a plugin", () => {
  it("takes its contributions off every surface, not just its listeners", () => {
    const seen: PluginLifecycleEvent[] = [];
    const registry = new PluginRegistry();
    registry.register({ id: "voice", plugin: fullPlugin(seen) });

    registry.disposePlugin("voice");

    expect(registry.getComposerContributions("machine-1")).toEqual([]);
    expect(registry.getSettingsSections("machine-1")).toEqual([]);
    expect(registry.findMessageRenderer("poll", "machine-1")).toBeUndefined();
    expect(registry.hasPlugin("voice")).toBe(false);
  });

  it("frees its ids so the same plugin can register again", () => {
    const seen: PluginLifecycleEvent[] = [];
    const registry = new PluginRegistry();
    registry.register({ id: "voice", plugin: fullPlugin(seen) });
    registry.disposePlugin("voice");

    expect(() => { registry.register({ id: "voice", plugin: fullPlugin(seen) }); }).not.toThrow();
    expect(registry.getComposerContributions("machine-1")).toHaveLength(1);
  });

  it("leaves no listener behind when a registration is refused after activation", () => {
    const seen: PluginLifecycleEvent[] = [];
    const registry = new PluginRegistry();
    const doubleClaim: PiWebPlugin = {
      apiVersion: 2,
      name: "Double",
      activate: (context) => {
        context.on?.("session-selected", (event) => { seen.push(event); });
        return {
          contributions: {
            messageRenderers: [
              { id: "one", tag: "poll", render: () => html`<div></div>` },
              { id: "two", tag: "poll", render: () => html`<div></div>` },
            ],
          },
        };
      },
    };

    expect(() => { registry.register({ id: "double", plugin: doubleClaim }); }).toThrow(/claimed twice/u);
    registry.emit({ kind: "session-selected", sessionId: "s1", machineId: "m1" });

    expect(seen).toEqual([]);
    expect(registry.findMessageRenderer("poll", "machine-1")).toBeUndefined();
  });

  it("runs the plugin dispose exactly once when refused", () => {
    const disposed = vi.fn();
    const registry = new PluginRegistry();
    const failing: PiWebPlugin = {
      apiVersion: 2,
      name: "Failing",
      activate: () => ({
        contributions: {
          composer: [
            { id: "same", slot: "trailing", title: "One", run: () => undefined },
            { id: "same", slot: "trailing", title: "Two", run: () => undefined },
          ],
        },
        dispose: disposed,
      }),
    };

    expect(() => { registry.register({ id: "failing", plugin: failing }); }).toThrow();

    expect(disposed).toHaveBeenCalledTimes(1);
    expect(registry.getComposerContributions("machine-1")).toEqual([]);
  });
});
