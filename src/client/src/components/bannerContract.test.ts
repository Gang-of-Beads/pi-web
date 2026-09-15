import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { panelHeaderStyles } from "./appShell/panelHeaderStyles.js";

/**
 * The banner contract the review lanes pinned: every title banner renders on
 * the panel-header height tokens - one height, one title size - instead of
 * each surface sizing its own. These are source-level assertions because the
 * drift they guard against happened across files, not inside one component.
 */
const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("the panel-header banner contract", () => {
  it("the shared template keys its height to the panel-header token", () => {
    expect(panelHeaderStyles.cssText).toContain("var(--pi-panel-header-height)");
    expect(panelHeaderStyles.cssText).toContain("var(--pi-panel-header-control-height)");
    expect(panelHeaderStyles.cssText).not.toContain("--pi-fg");
  });

  it("the drawer compact header sits exactly on the token with no vertical padding", () => {
    const css = read("./appShell/AppNavigationPanel.ts");
    const start = css.indexOf(".compact-header {");
    const rule = css.slice(start, css.indexOf("}", start));
    expect(rule).toContain("height: var(--pi-panel-header-height)");
    expect(rule).toContain("padding: 0 ");
    expect(rule).not.toMatch(/padding:\s+var\(--pi-space/);
  });

  it("the context sheet header has no top padding to scroll rows above the sticky title", () => {
    const css = read("./appShell/ContextSwitcherSheet.ts");
    const start = css.indexOf(".sheet {");
    const rule = css.slice(start, css.indexOf("}", start));
    expect(rule).toContain("padding: 0 var(");
    expect(css).toContain(".sheet-header { position: sticky; top: 0;");
    expect(css).not.toContain(".sheet-title {");
  });

  it("the settings phone header rides the same token row", () => {
    const css = read("./SettingsDialog.ts");
    expect(css).toContain(".settings-header { box-sizing: border-box; min-height: var(--pi-panel-header-height); padding: 0 max(var(--pi-bar-inset), env(safe-area-inset-right)) 0 max(var(--pi-bar-inset), env(safe-area-inset-left));");
    expect(css).toContain("width: var(--pi-panel-header-control-height); height: var(--pi-panel-header-control-height); } }");
  });

  it("the bundled plugin toolbar fits the token box it names", () => {
    const css = read("./shared.ts");
    const start = css.indexOf(".toolbar {");
    const rule = css.slice(start, css.indexOf("}", start));
    expect(rule).toContain("box-sizing: border-box");
    expect(rule).toContain("padding: 0 var(");
  });
});
