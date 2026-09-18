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

  it("the navigate path bar sits exactly on the token with no vertical padding", () => {
    const css = read("./appShell/AppNavigatePage.ts");
    const start = css.indexOf(".path-bar {");
    const rule = css.slice(start, css.indexOf("}", start));
    expect(rule).toContain("min-height: var(--pi-panel-header-height)");
    expect(rule).toMatch(/padding:\s*0 /u);
  });

  it("the context sheet header has no top padding to scroll rows above the sticky title", () => {
    const css = read("./appShell/ContextSwitcherSheet.ts");
    const start = css.indexOf(".sheet {");
    const rule = css.slice(start, css.indexOf("}", start));
    // The sheet carries no horizontal padding of its own: the list sections
    // keep their single 8px inset, so rows hug the edge once, not twice.
    expect(rule).toContain("padding: 0 0 var(");
    expect(css).toContain(".sheet-header { position: sticky; top: 0;");
    expect(css).toContain("margin-inline: 0; padding-inline: var(--pi-bar-inset);");
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
