import type { CSSResultGroup } from "lit";

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

/** Sheets this root received from adoptSheets, so a re-adoption replaces
 *  them instead of stacking duplicates. */
const adoptedByRoot = new WeakMap<ShadowRoot, CSSStyleSheet[]>();

/**
 * Adopt groups into a shadow root, replacing what a previous adoptSheets
 * call put there (foreign sheets, e.g. an element's own static styles, are
 * left alone).
 */
export function adoptSheets(root: ShadowRoot, groups: CSSResultGroup[]): void {
  const previous = adoptedByRoot.get(root) ?? [];
  const sheets = cssResultSheets(groups);
  root.adoptedStyleSheets = [...root.adoptedStyleSheets.filter((sheet) => !previous.includes(sheet) && !sheets.includes(sheet)), ...sheets];
  adoptedByRoot.set(root, sheets);
}
