import { describe, expect, it } from "vitest";
import { ChatView } from "./ChatView.js";
import type { SessionStatus } from "../api.js";
import type { PluginSurfaceState } from "../../../shared/apiTypes.js";

/**
 * The Goals drawer used to ask for room whether or not the plugin behind it
 * existed: an uninstalled plugin and an installed one with nothing in it drew
 * the same empty panel.
 *
 * These assertions are on the component, not on the classifier. The classifier
 * had its own passing tests while the field it reads never crossed the wire,
 * so the feature did nothing at all and nothing said so.
 */

function status(surfaces?: PluginSurfaceState): SessionStatus {
  return {
    sessionId: "s",
    ...(surfaces === undefined ? {} : { pluginSurfaces: { goals: surfaces } }),
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    messageCount: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  };
}

function drawerFor(surfaces?: PluginSurfaceState): unknown {
  const view = new ChatView();
  view.sessionId = "s";
  view.status = status(surfaces);
  view.goalsLoad = { state: "loaded", key: "k", data: [] };
  const render: unknown = Reflect.get(view, "renderTopDrawer");
  if (typeof render !== "function") throw new Error("Could not reach ChatView.renderTopDrawer");
  return render.call(view);
}

describe("the goals drawer against a runtime that was asked", () => {
  // Review H3 reversed the original assertion here: hiding the whole drawer
  // on goals-absent also hid ACTIVITY and NOTIFICATIONS, and re-inserted the
  // strip the moment a task started - the reflow the fixed-membership ruling
  // forbids. The drawer keeps its room; the GOALS tab says "not installed".
  it("keeps the drawer even when nothing provides the goals surface", () => {
    expect(drawerFor("absent")).not.toBeNull();
  });

  /** Not knowing is not knowing there is nothing there. */
  it("keeps its room when the runtime could not answer", () => {
    expect(drawerFor(undefined)).not.toBeNull();
  });

  /** A broken install stays visible rather than tidied away as uninstalled. */
  it("keeps its room when the plugin failed to load", () => {
    expect(drawerFor("failed")).not.toBeNull();
  });

  it("keeps its room for an installed plugin with nothing recorded yet", () => {
    expect(drawerFor("present")).not.toBeNull();
  });
});
