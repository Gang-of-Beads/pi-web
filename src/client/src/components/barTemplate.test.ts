import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The bar template, the owner's standing rule restated on 2026-09-15 with a
 * phone screenshot: the app is an SPA and its bars are one shape. Every
 * header, footer and toolbar is one bar tall (`--pi-panel-header-height`),
 * its controls one control tall (`--pi-panel-header-control-height`,
 * smaller than the bar so nothing touches the boundary), and the row is
 * inset from the screen edge by `--pi-bar-inset` (about a quarter of a
 * control). Page content sits one reading edge from the side, and on the
 * phone that edge is small.
 *
 * The producers are enumerated here because the drift lived across files:
 * a fixed producer never protects its siblings.
 */
const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const rule = (css: string, selector: string): string => {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`${selector} not found`);
  return css.slice(start, css.indexOf("}", start));
};

const indexHtml = read("../../index.html");

describe("the bar template tokens", () => {
  it("publishes one bar height, a smaller control height and an inset, on both breakpoints", () => {
    const heights = indexHtml.match(/--pi-panel-header-height:\s*([^;]+);/gu) ?? [];
    const controls = indexHtml.match(/--pi-panel-header-control-height:\s*([^;]+);/gu) ?? [];
    expect(heights).toEqual(["--pi-panel-header-height: 44px;", "--pi-panel-header-height: 44px;"]);
    expect(controls).toEqual(["--pi-panel-header-control-height: 36px;", "--pi-panel-header-control-height: 36px;"]);
    expect(indexHtml).toContain("--pi-bar-inset: var(--pi-space-4);");
  });
});

const producers: { name: string; file: string; selector: string; height: "height" | "min-height" }[] = [
  { name: "navigate path bar", file: "./appShell/AppNavigatePage.ts", selector: ".path-bar {", height: "min-height" },
  { name: "chat context bar", file: "./appShell/AppContextBar.ts", selector: ".context-bar {", height: "min-height" },
  { name: "workspace tool header", file: "./shared.ts", selector: "header.panel-header {", height: "min-height" },
  { name: "workspace tool toolbar", file: "./shared.ts", selector: ".workspace-tool-toolbar {", height: "min-height" },
  { name: "bundled plugin toolbar", file: "./shared.ts", selector: ".toolbar {", height: "min-height" },
  { name: "chat drawer header", file: "./ChatView.ts", selector: "\n  .drawer-header {", height: "min-height" },
];

/**
 * The status footer is not a bar: it holds no controls, only a tally, and the
 * owner asked for a third of the height back for the transcript. It still owes
 * the template its inset, and its height stays derived from the bar token so
 * the two cannot drift apart.
 */
const statusFooterHeight = "calc(var(--pi-panel-header-height) * 4 / 9)";

describe("the status footer", () => {
  it("is two thirds of the bar height and keeps the bar inset", () => {
    const css = read("./StatusBar.ts");
    const start = css.indexOf(".bar {");
    const found = css.slice(start, css.indexOf("}", start));
    expect(found).toContain(`min-height: ${statusFooterHeight}`);
    expect(found).toMatch(/padding: (?:0|var\(--pi-space-\d\)) var\(--pi-bar-inset\)/u);
  });
});

describe("every bar producer", () => {
  for (const producer of producers) {
    it(`${producer.name} rides the bar height and the bar inset`, () => {
      const css = read(producer.file);
      const found = rule(css, producer.selector);
      const heightRule = producer.height === "height" ? /(?<![-\w])height: var\(--pi-panel-header-height\)/u : /min-height: var\(--pi-panel-header-height\)/u;
      if (producer.selector === "header.panel-header {") expect(read("./appShell/panelHeaderStyles.ts")).toContain("min-height: var(--pi-panel-header-height)");
      else expect(found).toMatch(heightRule);
      expect(found).toMatch(/padding: (?:0|var\(--pi-space-\d\)) var\(--pi-bar-inset\)/u);
    });
  }

  it("the composer footer is a bar too on the phone", () => {
    const css = read("./PromptEditor.ts");
    expect(css).toContain("footer { gap: var(--pi-space-3); padding: var(--pi-space-3) var(--pi-bar-inset); }");
    expect(css).toContain(".actions { min-height: var(--pi-panel-header-height); gap: var(--pi-space-3); }");
  });

  it("the sessions list header and the settings and sheet headers ride the same tokens", () => {
    expect(rule(read("./SessionList.ts"), "h2 { min-height: var(--pi-panel-header-height)")).toBeTruthy();
    expect(read("./SessionList.ts")).toContain(".start-session-button { min-width: 0; height: var(--pi-panel-header-control-height); line-height: var(--pi-panel-header-control-height); }");
    expect(read("./SettingsDialog.ts")).toContain(".settings-header { box-sizing: border-box; min-height: var(--pi-panel-header-height); padding: 0 max(var(--pi-bar-inset), env(safe-area-inset-right)) 0 max(var(--pi-bar-inset), env(safe-area-inset-left));");
    expect(read("./SettingsDialog.ts")).toContain(".close-button { box-sizing: border-box; width: var(--pi-control-height-comfort); height: var(--pi-control-height-comfort); display: grid; place-items: center; border: 1px solid var(--pi-border); background: var(--pi-surface);");
    expect(read("./appShell/ContextSwitcherSheet.ts")).toContain("margin-inline: 0; padding-inline: var(--pi-bar-inset);");
  });
});

describe("controls inside bars", () => {
  it("are one control tall, never the touch floor that would fill the bar", () => {
    const contextBar = read("./appShell/AppContextBar.ts");
    expect(contextBar).not.toMatch(/\.panel-toggle\s*\{[^}]*var\(--pi-control-height-touch\)/u);
    const sessionList = read("./SessionList.ts");
    expect(sessionList).toContain(".bulk-select-entry { width: var(--pi-panel-header-control-height); min-width: var(--pi-panel-header-control-height); height: var(--pi-panel-header-control-height); }");
    expect(sessionList).toContain(".action-menu-toggle { min-width: var(--pi-panel-header-control-height); min-height: var(--pi-panel-header-control-height); }");
    expect(read("./shared.ts")).toContain(".toolbar button { margin-left: auto; box-sizing: border-box; min-height: var(--pi-panel-header-control-height); }");
  });
});
