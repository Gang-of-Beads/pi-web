import type { CSSResultGroup, CSSResultArray } from "lit";
import type { PluginHostUi } from "@gang-of-beads/pi-web/plugin-api";

/**
 * The host utilities this plugin was activated with.
 *
 * `static styles` freezes at module load, which runs before the host is
 * remembered - the elements are imported for their side effects by the plugin
 * entry before activate() runs - so the host sheets are adopted per element
 * instance in createRenderRoot instead. Absent means the host offered none:
 * the elements then adopt nothing and simply go without, because copying the
 * host's styles or wording would drift the moment either side changed.
 */

let hostUi: PluginHostUi | undefined;

export function rememberFilesHostUi(ui: PluginHostUi | undefined): void {
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

export function adoptFilesHostStyles(root: ShadowRoot): void {
  if (hostUi === undefined) return;
  const sheets = cssResultSheets([hostUi.surfaceStyles, hostUi.workspacePanelStyles, hostUi.textStyles]);
  if (sheets.length === 0) return;
  root.adoptedStyleSheets = [...root.adoptedStyleSheets, ...sheets];
}

export function describeFilesError(error: unknown): string {
  return hostUi === undefined ? String(error) : hostUi.describeError(error);
}

export function filesRenderMarkdownHtml(markdown: string): string {
  return hostUi === undefined ? "" : hostUi.renderMarkdownHtml(markdown);
}

export function filesRegisterModal(registration: {
  element: HTMLElement;
  paintElement?: HTMLElement;
  focus?: () => void;
  onTopChange?: (isTop: boolean) => void;
}): { readonly isTop: boolean; focus(): boolean; unregister(): void } | undefined {
  return hostUi?.registerModal(registration);
}

export function filesQuery(): PluginHostUi["query"] | undefined {
  return hostUi?.query;
}

/**
 * The shell's disclosure chevron, so the file tree spells "this folder opens"
 * the way every other list in the app spells it.
 */
export function renderHostDisclosureIcon(collapsed: boolean): unknown {
  return hostUi?.renderDisclosureIcon?.(collapsed);
}
