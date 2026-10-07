import type { PluginSurfacePresence, PluginSurfaceState } from "../../shared/apiTypes";

/**
 * Whether a page that fronts an agent-side surface belongs in Go to for the session on screen
 * (extension-keys-in-go-to.md). Only a known absence leaves it out: a failed load is not absence
 * (the page says why), and no answer - no session on screen, or a daemon that does not report -
 * cannot rule it out.
 */
const SHOWN: Readonly<Record<PluginSurfaceState, boolean>> = { present: true, failed: true, absent: false };

export function frontedPageShown(fronts: string | undefined, surfaces: PluginSurfacePresence | undefined): boolean {
  if (fronts === undefined) return true;
  const state = surfaces?.[fronts];
  return state === undefined || SHOWN[state];
}
