import type { CSSResultGroup } from "lit";
import type { PluginHostUi } from "@gang-of-beads/pi-web/plugin-api";

/**
 * The host utilities this plugin was activated with.
 *
 * The panel is a custom element whose styles are read when its module is first
 * evaluated, so the plugin records what the host gave it and imports the panel
 * afterwards. Absent means the host offered none, and the panel goes without
 * rather than carrying a copy of the host's chrome that would drift from it.
 */

let hostUi: PluginHostUi | undefined;

export function rememberGoalsHostUi(ui: PluginHostUi | undefined): void {
  hostUi = ui;
}

export function goalsPanelStyles(): CSSResultGroup[] {
  return hostUi === undefined ? [] : [hostUi.listStyles, hostUi.surfaceStyles];
}
