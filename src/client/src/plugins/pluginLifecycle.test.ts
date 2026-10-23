import { describe, expect, it, vi } from "vitest";
import { PluginRegistry } from "./registry";
import type { PiWebPlugin, PluginLifecycleEvent } from "./types";

function listeningPlugin(seen: PluginLifecycleEvent[], dispose?: () => void): PiWebPlugin {
  return {
    apiVersion: 2,
    name: "Listener",
    activate: (context) => {
      context.on?.("session-selected", (event) => { seen.push(event); });
      context.on?.("page-shown", (event) => { seen.push(event); });
      context.on?.("page-hidden", (event) => { seen.push(event); });
      return { contributions: {}, ...(dispose === undefined ? {} : { dispose }) };
    },
  };
}

describe("plugin lifecycle events", () => {
  it("delivers a host fact to a subscribed plugin", () => {
    const seen: PluginLifecycleEvent[] = [];
    const registry = new PluginRegistry();
    registry.register({ id: "listener", plugin: listeningPlugin(seen) });

    registry.emit({ kind: "session-selected", sessionId: "s1", machineId: "m1" });

    expect(seen).toEqual([{ kind: "session-selected", sessionId: "s1", machineId: "m1" }]);

    const otherSeen: PluginLifecycleEvent[] = [];
    registry.register({ id: "other", plugin: listeningPlugin(otherSeen) });
    seen.length = 0;
    const changes = [
      registry.showPage({ pageId: "listener:files", pluginId: "listener", machineId: "local", workspaceId: "ws-a" }),
      registry.showPage({ pageId: "listener:files", pluginId: "listener", machineId: "local", workspaceId: "ws-a" }),
      registry.isPageShown("listener:files", "local", "ws-a"),
      registry.isPageShown("listener:files", "remote-1", "ws-a"),
      registry.showPage({ pageId: "listener:files", pluginId: "listener", machineId: "local", workspaceId: "ws-b" }),
      registry.isPageShown("listener:files", "local", "ws-a"),
      registry.showPage({ pageId: "listener:files", pluginId: "listener", machineId: "remote-1", workspaceId: "ws-b" }),
      registry.showPage({ pageId: "other:updates", pluginId: "other", machineId: "remote-1", workspaceId: undefined }),
      registry.showPage(undefined),
      registry.isPageShown("other:updates", "remote-1", undefined),
    ];

    expect({ changes, seen, otherSeen }).toEqual({
      changes: [true, false, true, false, true, false, true, true, true, false],
      seen: [
        { kind: "page-shown", pageId: "listener:files", machineId: "local", workspaceId: "ws-a" },
        { kind: "page-hidden", pageId: "listener:files", machineId: "local", workspaceId: "ws-a" },
        { kind: "page-shown", pageId: "listener:files", machineId: "local", workspaceId: "ws-b" },
        { kind: "page-hidden", pageId: "listener:files", machineId: "local", workspaceId: "ws-b" },
        { kind: "page-shown", pageId: "listener:files", machineId: "remote-1", workspaceId: "ws-b" },
        { kind: "page-hidden", pageId: "listener:files", machineId: "remote-1", workspaceId: "ws-b" },
      ],
      otherSeen: [
        { kind: "page-shown", pageId: "other:updates", machineId: "remote-1" },
        { kind: "page-hidden", pageId: "other:updates", machineId: "remote-1" },
      ],
    });
  });

  it("delivers nothing for a kind nobody subscribed to", () => {
    const seen: PluginLifecycleEvent[] = [];
    const registry = new PluginRegistry();
    registry.register({ id: "listener", plugin: listeningPlugin(seen) });

    registry.emit({ kind: "connection-changed", machineId: "local", connected: false });

    expect(seen).toEqual([]);
  });

  it("keeps siblings alive when one listener throws", () => {
    const seen: PluginLifecycleEvent[] = [];
    const registry = new PluginRegistry();
    const thrower: PiWebPlugin = {
      apiVersion: 2,
      name: "Thrower",
      activate: (context) => {
        context.on?.("session-selected", () => { throw new Error("boom"); });
        return { contributions: {} };
      },
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      registry.register({ id: "thrower", plugin: thrower });
      registry.register({ id: "listener", plugin: listeningPlugin(seen) });

      expect(() => { registry.emit({ kind: "session-selected", sessionId: "s1", machineId: undefined }); }).not.toThrow();
      expect(seen).toHaveLength(1);
    } finally {
      errors.mockRestore();
    }
  });

  it("drops subscriptions and runs the plugin dispose on unregister", () => {
    const seen: PluginLifecycleEvent[] = [];
    const disposed = vi.fn();
    const registry = new PluginRegistry();
    registry.register({ id: "listener", plugin: listeningPlugin(seen, disposed) });

    registry.disposePlugin("listener");
    registry.emit({ kind: "session-selected", sessionId: "s1", machineId: undefined });

    expect(disposed).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([]);
  });

  it("unsubscribes through the returned function", () => {
    const seen: PluginLifecycleEvent[] = [];
    const registry = new PluginRegistry();
    registry.register({
      id: "once",
      plugin: {
        apiVersion: 2,
        name: "Once",
        activate: (context) => {
          const off = context.on?.("session-left", (event) => { seen.push(event); });
          off?.();
          return { contributions: {} };
        },
      },
    });

    registry.emit({ kind: "session-left", sessionId: "s1", machineId: "local" });

    expect(seen).toEqual([]);
  });

  it("qualifies and scopes settings sections", () => {
    const registry = new PluginRegistry();
    registry.register({
      id: "voice",
      plugin: {
        apiVersion: 2,
        name: "Voice",
        activate: ({ html }) => ({ contributions: { settingsSections: [{ id: "voice", title: "Voice", render: () => html`<div></div>` }] } }),
      },
    });

    const sections = registry.getSettingsSections("machine-1");

    expect(sections).toHaveLength(1);
    expect(sections[0]?.id).toBe("voice:voice");
    expect(registry.getSettingsSections(undefined)).toEqual([]);
  });
});
