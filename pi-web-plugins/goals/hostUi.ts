import type { CSSResultGroup, CSSResultArray } from "lit";
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

function isCssResultGroupArray(group: CSSResultGroup): group is CSSResultArray {
  return Array.isArray(group);
}

export function adoptGoalsHostStyles(root: ShadowRoot): void {
  if (hostUi === undefined) return;
  const sheets: CSSStyleSheet[] = [];
  const collect = (group: CSSResultGroup): void => {
    if (!isCssResultGroupArray(group) && "cssText" in group) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(group.cssText);
      sheets.push(sheet);
      return;
    }
    if (isCssResultGroupArray(group)) group.forEach(collect);
  };
  collect(hostUi.surfaceStyles);
  if (sheets.length === 0) return;
  root.adoptedStyleSheets = [...root.adoptedStyleSheets, ...sheets];
}
