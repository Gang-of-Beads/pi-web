import { loadedExtensionsView, pluginPresence, type ExtensionListSource } from "./pluginPresence.js";
import type { PluginSurfacePresence } from "../../../shared/apiTypes.js";

/**
 * The tools that make each plugin-backed surface worth showing.
 *
 * Named by tool rather than by package because a fork, a rename or a local
 * checkout provides the surface just as well - this repository runs a fork of
 * the goal plugin, and a package-name check would call its own goals absent.
 *
 * One tool is enough. A plugin that registers a subset still has something
 * behind the panel, and demanding the full set would hide a working surface
 * because one tool was renamed upstream.
 */
const SURFACE_TOOLS = {
  goals: ["create_goal", "get_goal", "update_goal", "focus_goal"],
  subagents: ["subagent"],
} as const;

/**
 * What each plugin-backed surface can honestly say about itself, or undefined
 * when the runtime cannot answer.
 *
 * Undefined is the important value: it means unknown, and a browser must keep
 * showing a surface it cannot rule out. Reporting "not installed" on no
 * evidence is exactly the fault this replaces - an uninstalled plugin and an
 * installed one with nothing in it used to render the same empty panel.
 */
export function pluginSurfacePresence(source: ExtensionListSource): PluginSurfacePresence | undefined {
  const loaded = loadedExtensionsView(source);
  if (loaded === undefined) return undefined;
  return {
    goals: pluginPresence(loaded, SURFACE_TOOLS.goals).state,
    subagents: pluginPresence(loaded, SURFACE_TOOLS.subagents).state,
  };
}
