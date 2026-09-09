import type { PluginHostUi } from "@gang-of-beads/pi-web/plugin-api";

/**
 * What the git surfaces borrow from the host.
 *
 * The panel is built from a factory rather than a custom element, but the same
 * rule applies: a decision the shell owns is borrowed, not copied. Today that
 * is the disclosure chevron, so the git tree spells "this folder opens" the way
 * every other list in the app spells it instead of with a text arrow.
 */
let hostUi: PluginHostUi | undefined;

export function rememberGitHostUi(ui: PluginHostUi | undefined): void {
  hostUi = ui;
}

export function renderGitDisclosureIcon(collapsed: boolean): unknown {
  return hostUi?.renderDisclosureIcon?.(collapsed);
}
