import type { PluginHostUi } from "@gang-of-beads/pi-web/plugin-api";

/** The host utilities this plugin was activated with. `static styles` freezes
 *  at module load - before the host is remembered - so the host sheets are
 *  adopted per element instance in createRenderRoot. Absent means the host
 *  offered none: the element then goes without rather than copying the host's
 *  styles (a copy would drift the moment either side changed). */

let hostUi: PluginHostUi | undefined;

export function rememberGoalsHostUi(ui: PluginHostUi | undefined): void {
  hostUi = ui;
}

export function adoptGoalsHostStyles(root: ShadowRoot): void {
  if (hostUi === undefined) return;
  hostUi.adoptSheets?.(root, [hostUi.surfaceStyles]);
}
