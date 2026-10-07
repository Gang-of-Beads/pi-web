import { loadedExtensionsView, pluginPresence, type ExtensionListSource } from "./pluginPresence.js";
import type { PluginSurfacePresence } from "../../../shared/apiTypes.js";
import { declaredAgentFacts } from "./declaredAgentFacts.js";

/**
 * What each declared surface can honestly say about itself in one session, or undefined when the
 * runtime cannot answer.
 *
 * The surfaces are the ones the loaded server plugins declare (`agentFacts.surfaces`), each with
 * the tools that prove it is backed; the host names none of them (owner, 2026-10-07: a plugin
 * declares that it needs a key, the host does not). A surface declared by two plugins is backed by
 * any tool either names.
 *
 * Undefined is the important value: it means unknown, and a browser must keep showing a surface it
 * cannot rule out. Reporting "not installed" on no evidence is exactly the fault this replaces - an
 * uninstalled plugin and an installed one with nothing in it used to render the same empty panel.
 */
export function pluginSurfacePresence(source: ExtensionListSource): PluginSurfacePresence | undefined {
  const loaded = loadedExtensionsView(source);
  if (loaded === undefined) return undefined;
  const tools = new Map<string, string[]>();
  for (const { surface, tools: named } of declaredAgentFacts().surfaces) tools.set(surface, [...(tools.get(surface) ?? []), ...named]);
  return Object.fromEntries([...tools].map(([surface, named]) => [surface, pluginPresence(loaded, named).state]));
}
