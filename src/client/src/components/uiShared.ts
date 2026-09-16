import type { CSSResultGroup } from "lit";
import { panelHeaderStyles } from "./appShell/panelHeaderStyles";

/**
 * The one mechanism behind every shadow-root style adoption: the shell
 * surfaces and the bundled plugin hostUi wrappers all route through here, so
 * the cssResultSheets dance exists once and a shell-side retune reaches
 * every adopter through the same sheets.
 */
export function cssResultSheets(groups: CSSResultGroup[]): CSSStyleSheet[] {
  const sheets: CSSStyleSheet[] = [];
  const collect = (group: CSSResultGroup): void => {
    if (Array.isArray(group)) {
      group.forEach(collect);
      return;
    }
    if ("cssText" in group) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(group.cssText);
      sheets.push(sheet);
    }
  };
  groups.forEach(collect);
  return sheets;
}

/** Adopt sheets into a shadow root, replacing sheets this helper produced before. */
export function adoptSheets(root: ShadowRoot, groups: CSSResultGroup[]): void {
  const sheets = cssResultSheets(groups);
  if (sheets.length === 0) return;
  root.adoptedStyleSheets = [...root.adoptedStyleSheets.filter((sheet) => !sheets.includes(sheet)), ...sheets];
}

/** The host's standard set: everything a tool surface needs in one call. */
export function sharedControlGroups(host: { surfaceStyles: CSSResultGroup; listStyles?: CSSResultGroup; workspacePanelStyles?: CSSResultGroup }): CSSResultGroup[] {
  return [host.surfaceStyles, ...(host.workspacePanelStyles === undefined ? [] : [host.workspacePanelStyles]), ...(host.listStyles === undefined ? [] : [host.listStyles]), panelHeaderStyles];
}
