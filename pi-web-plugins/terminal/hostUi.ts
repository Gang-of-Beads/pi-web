import type { CSSResultArray, CSSResultGroup } from "lit";
import type { PluginHostUi } from "@gang-of-beads/pi-web/plugin-api";

/**
 * The host utilities this plugin was activated with.
 *
 * `static styles` freezes at module load, which runs before the host is
 * remembered - the panel module is imported for its side effects by the plugin
 * entry before activate() runs - so the host sheets are adopted per element
 * instance in createRenderRoot instead. Absent means the host offered none:
 * the panel then adopts nothing and simply goes without, because copying the
 * host's clipboard chain or its wording would drift the moment either side
 * changed.
 */

let hostUi: PluginHostUi | undefined;

export function rememberTerminalHostUi(ui: PluginHostUi | undefined): void {
  hostUi = ui;
}

function isCssResultGroupArray(group: CSSResultGroup): group is CSSResultArray {
  return Array.isArray(group);
}

function cssResultSheets(groups: CSSResultGroup[]): CSSStyleSheet[] {
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
  groups.forEach(collect);
  return sheets;
}

export function adoptTerminalHostStyles(root: ShadowRoot): void {
  if (hostUi === undefined) return;
  const sheets = cssResultSheets([hostUi.surfaceStyles, hostUi.workspacePanelStyles]);
  if (sheets.length === 0) return;
  root.adoptedStyleSheets = [...root.adoptedStyleSheets, ...sheets];
}

export function copyTerminalText(text: string): Promise<boolean> {
  return hostUi === undefined ? Promise.resolve(false) : hostUi.copyText(text);
}

export function describeTerminalError(error: unknown): string {
  return hostUi === undefined ? String(error) : hostUi.describeError(error);
}

export function coarseOrMobileQuery(): string | undefined {
  return hostUi?.breakpoints.coarseOrMobile;
}
