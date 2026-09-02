import type { PluginSurfaceState } from "../../shared/apiTypes.js";

/** Why a plugin-backed surface is or is not on screen. */
export type SurfaceVisibility =
  | { show: false; reason: "not-installed" }
  | { show: true; reason: "has-content" | "loading" | "load-failed" | "plugin-failed" | "presence-unknown" };

/**
 * Whether a plugin-backed panel belongs on screen.
 *
 * The old rule was "show it if it has rows, or is loading, or failed to load",
 * which cannot tell an uninstalled plugin from an installed one with nothing in
 * it yet - both render an empty panel, and neither says which it is. The
 * runtime can now say whether anything provides the surface at all.
 *
 * Only a definite "nothing provides this" hides the panel. Every other answer
 * keeps it:
 *
 * - unknown presence keeps it, because a daemon that predates the field or a
 *   runtime that cannot answer is not evidence of absence, and hiding a working
 *   panel is worse than showing an empty one;
 * - a plugin that failed to load keeps it, so a broken install is visible
 *   instead of tidied away as "not installed";
 * - content, a read in flight, or a failed read keep it for the reasons they
 *   always did.
 */
export function pluginSurfaceVisibility(input: {
  presence: PluginSurfaceState | undefined;
  hasContent: boolean;
  loading: boolean;
  loadFailed: boolean;
}): SurfaceVisibility {
  if (input.hasContent) return { show: true, reason: "has-content" };
  if (input.loading) return { show: true, reason: "loading" };
  if (input.loadFailed) return { show: true, reason: "load-failed" };
  if (input.presence === "failed") return { show: true, reason: "plugin-failed" };
  if (input.presence === undefined) return { show: true, reason: "presence-unknown" };
  if (input.presence === "absent") return { show: false, reason: "not-installed" };
  return { show: true, reason: "has-content" };
}
