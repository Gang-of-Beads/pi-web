import { describe, expect, it } from "vitest";
import { html } from "lit";
import { ChatView } from "./ChatView.js";
import type { SessionStatus } from "../api.js";
import type { PluginSurfaceState } from "../../../shared/apiTypes.js";
import type { QualifiedDrawerSectionContribution } from "../plugins/types.js";

/**
 * The drawer is sections-driven now: it renders exactly what plugins
 * contribute and disappears when nothing does. These assertions pin the
 * hosting contract - a contributed section keeps the drawer alive whatever the
 * runtime answered, because the section itself owns the "not installed" and
 * failure sentences.
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

function goalsSection(): QualifiedDrawerSectionContribution {
  return {
    id: "goals:goals",
    pluginId: "goals",
    localId: "goals",
    title: "Goals",
    render: () => html`<div class="goal-list"></div>`,
  };
}

function drawerFor(surfaces?: PluginSurfaceState, sections: QualifiedDrawerSectionContribution[] = [goalsSection()]): unknown {
  const view = new ChatView();
  view.sessionId = "s";
  view.status = status(surfaces);
  view.drawerSections = sections;
  const render: unknown = Reflect.get(view, "renderTopDrawer");
  if (typeof render !== "function") throw new Error("Could not reach ChatView.renderTopDrawer");
  return render.call(view);
}

describe("the goals drawer against a runtime that was asked", () => {
  // The drawer hosts whatever a plugin contributes; the surface answer is the
  // section's business, not the shell's. The shell's own honesty rule is the
  // other edge: no sections at all means no drawer, never an empty frame.
  it("keeps hosting the goals section when nothing provides the goals surface", () => {
    expect(drawerFor("absent")).not.toBeNull();
  });

  /** Not knowing is not knowing there is nothing there. */
  it("keeps hosting the section when the runtime could not answer", () => {
    expect(drawerFor(undefined)).not.toBeNull();
  });

  /** A broken install stays visible rather than tidied away as uninstalled. */
  it("keeps hosting the section when the plugin failed to load", () => {
    expect(drawerFor("failed")).not.toBeNull();
  });

  it("keeps hosting the section for an installed plugin with nothing recorded yet", () => {
    expect(drawerFor("present")).not.toBeNull();
  });

  it("renders nothing when no plugin contributes a section", () => {
    expect(drawerFor("present", [])).toBeNull();
  });
});
