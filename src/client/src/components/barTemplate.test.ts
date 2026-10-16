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
 * phone that edge is small. A bar that can hold a corner key, and the
 * composer under the messages, sits on the conversation gutter instead, so
 * the keys line up with the messages (owner, 2026-10-16); below 640px the
 * gutter is the bar inset.
 *
 * The producers are enumerated here because the drift lived across files:
 * a fixed producer never protects its siblings.
 */
const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8").replace(/\r\n/gu, "\n");
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
  { name: "workspace tool toolbar", file: "./shared.ts", selector: ".workspace-tool-toolbar {", height: "min-height" },
  { name: "bundled plugin toolbar", file: "./shared.ts", selector: ".toolbar {", height: "min-height" },
];

/**
 * The status footer is not a bar: it holds no controls, only a tally, and the
 * owner asked for a third of the height back for the transcript. Its tally
 * keeps the messages' edge (the conversation gutter), and its height stays
 * derived from the bar token so the two cannot drift apart.
 */
const statusFooterHeight = "calc(var(--pi-panel-header-height) * 4 / 9)";

describe("the shared panel header", () => {
  it("rides the bar height and the bar inset on every surface that still draws it", () => {
    const css = read("./appShell/panelHeaderStyles.ts");
    expect(css).toContain("min-height: var(--pi-panel-header-height);");
    expect(css).toContain("padding-inline: var(--pi-bar-inset);");
  });
});

describe("the status footer", () => {
  it("is two thirds of the bar height and sits on the conversation gutter", () => {
    const css = read("./StatusBar.ts");
    const start = css.indexOf(".bar {");
    const found = css.slice(start, css.indexOf("}", start));
    expect(found).toContain(`min-height: ${statusFooterHeight}`);
    expect(found).toMatch(/padding: (?:0|var\(--pi-space-\d\)) var\(--pi-chat-gutter\)/u);
  });
});

describe("every bar producer", () => {
  for (const producer of producers) {
    it(`${producer.name} rides the bar height and the bar inset`, () => {
      const css = read(producer.file);
      const found = rule(css, producer.selector);
      const heightRule = producer.height === "height" ? /(?<![-\w])height: var\(--pi-panel-header-height\)/u : /min-height: var\(--pi-panel-header-height\)/u;
      expect(found).toMatch(heightRule);
      expect(found).toMatch(/padding: (?:0|var\(--pi-space-\d\)) var\(--pi-(?:bar-inset|chat-gutter)\)/u);
    });
  }

  it("the composer footer is a bar too on the phone", () => {
    const css = read("./PromptEditor.ts");
    expect(css).toContain("footer { gap: var(--pi-space-3); padding: var(--pi-space-3) var(--pi-chat-gutter); }");
    expect(css).toContain(".actions { min-height: var(--pi-panel-header-height); gap: var(--pi-space-3); }");
  });

  it("the settings and sheet headers ride the same tokens", () => {
    expect(read("./SettingsDialog.ts")).toContain(".settings-header { box-sizing: border-box; min-height: var(--pi-panel-header-height); padding: 0 max(var(--pi-chat-gutter), env(safe-area-inset-right)) 0 max(var(--pi-chat-gutter), env(safe-area-inset-left));");
    expect(read("./SettingsDialog.ts")).toContain('<button class="close-button bar-key"');
    expect(read("./appShell/panelHeaderStyles.ts")).toContain("border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text);");
    expect(read("./appShell/ContextSwitcherSheet.ts")).toContain("margin-inline: 0; padding-inline: var(--pi-chat-gutter);");
  });
});

/**
 * Edges the owner asked for: the context bar's keys stand on the conversation's gutter on every
 * layout (2026-10-16, after the iPad showed them 8px outside the messages), and on desktop the
 * composer's action row has the same space below as above (2026-09-29), scoped to the desktop
 * layout so the phone keeps the bar template.
 */
describe("desktop edges", () => {
  const desktop = "@media not (${unsafeCSS(PHONE_LAYOUT_MEDIA_QUERY)})";
  it("puts the context bar's keys on the conversation gutter, on every layout", () => {
    expect(read("./appShell/AppContextBar.ts")).toContain("padding: 0 var(--pi-chat-gutter);");
  });

  it("gives the composer's action row the gap from the input below it too, on desktop only", () => {
    const css = read("./PromptEditor.ts");
    expect(css).toContain("gap: var(--pi-space-4); padding: var(--pi-space-6) var(--pi-chat-gutter);");
    expect(css).toContain(`${desktop} {\n    footer { padding-bottom: var(--pi-space-4); }`);
  });
});

describe("controls inside bars", () => {
  it("are one control tall, never the touch floor that would fill the bar", () => {
    const contextBar = read("./appShell/AppContextBar.ts");
    expect(contextBar).not.toMatch(/\.panel-toggle\s*\{[^}]*var\(--pi-control-height-touch\)/u);
    expect(read("./shared.ts")).toContain(".toolbar button { margin-left: auto; box-sizing: border-box; min-height: var(--pi-panel-header-control-height); }");
  });
});
