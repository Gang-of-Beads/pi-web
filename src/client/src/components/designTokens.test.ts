import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appStyles, chatStyles, listStyles, promptEditorStyles, workspacePanelStyles } from "./shared";

/**
 * The scale, as a contract.
 *
 * Spacing, type sizes and radii used to be chosen per rule: 5, 6, 7, 8, 9, 10
 * and 12 pixel paddings, three radii for the same kind of card, font sizes
 * picked by eye. Nothing lined up, and density read as accidental rather than
 * decided. These assertions keep the decision in one place: shared styles use
 * the scale tokens, and the scale itself is published where every shadow root
 * can inherit it.
 *
 * They are deliberately about the shared sheets. A one-off value inside a
 * single component is a judgement call; a one-off value in the sheet every
 * surface adopts is a scale with a hole in it.
 */

const SHARED_SHEETS = [
  ["appStyles", String(appStyles)],
  ["listStyles", String(listStyles)],
  ["chatStyles", String(chatStyles)],
  ["promptEditorStyles", String(promptEditorStyles)],
  ["workspacePanelStyles", String(workspacePanelStyles)],
] as const;

const indexHtml = readFileSync(join(process.cwd(), "src/client/index.html"), "utf8");

describe("scale tokens are published to every shadow root", () => {
  it.each([
    ["spacing", ["--pi-space-1", "--pi-space-4", "--pi-space-9"]],
    ["type", ["--pi-text-2xs", "--pi-text-base", "--pi-text-xl"]],
    ["radius", ["--pi-radius-xs", "--pi-radius-md", "--pi-radius-pill"]],
    ["motion", ["--pi-motion-fast", "--pi-motion-base", "--pi-ease"]],
    ["focus", ["--pi-focus-ring-width", "--pi-focus-ring-offset"]],
    ["type stacks", ["--pi-font-ui", "--pi-font-display", "--pi-font-mono"]],
  ])("defines the %s scale on :root", (_name, tokens) => {
    for (const token of tokens) expect(indexHtml).toContain(`${token}:`);
  });
});

describe("shared styles spend the scale rather than raw values", () => {
  it.each(SHARED_SHEETS)("%s uses spacing tokens", (_name, css) => {
    expect(css).toContain("var(--pi-space-");
  });

  // The values that used to be picked by eye. A raw `padding: 7px` in a shared
  // sheet is the thing this suite exists to catch.
  it.each(SHARED_SHEETS)("%s has no off-scale padding or gap", (_name, css) => {
    const offScale = [...css.matchAll(/(?:padding|gap|margin)(?:-[a-z]+)?: ([^;{}]*\b(?:5|7|9|11|13|15)px)/g)].map((match) => match[1]);
    expect(offScale).toEqual([]);
  });

  it.each(SHARED_SHEETS)("%s rounds corners from the radius scale", (_name, css) => {
    const offScale = [...css.matchAll(/border-radius: ([^;{}]*\b\d+px)/g)]
      .map((match) => match[1] ?? "")
      .filter((value) => !value.includes("var(--pi-radius-"));
    expect(offScale).toEqual([]);
  });
});

describe("accessibility floors", () => {
  it("draws one focus ring, from the focus tokens", () => {
    const focusRules = [...String(listStyles).matchAll(/outline: ([^;]+);/g)].map((match) => match[1]);
    expect(focusRules.length).toBeGreaterThan(0);
    for (const rule of focusRules) expect(rule).toContain("var(--pi-focus-ring-width)");
  });

  it("honours reduced motion wherever motion is defined", () => {
    // Every sheet that animates has to opt out under the preference; asserting
    // one of them would let a new animation ship without the guard.
    for (const [, css] of SHARED_SHEETS) {
      if (!css.includes("transition:") && !css.includes("animation:")) continue;
      expect(css).toContain("prefers-reduced-motion: reduce");
    }
  });

  it("keeps touch targets at the platform floor", () => {
    // 44px is the smallest target a finger hits reliably; the token exists so
    // that number is stated once rather than retyped per control.
    expect(indexHtml).toContain("--pi-control-height-touch: 44px");
  });

  it("lets the hidden attribute win over every :host display rule", () => {
    // A custom element with `display` on :host ignores the HTML hidden
    // attribute unless it says otherwise, and the failure is silent: the markup
    // reads as hidden and the element is on screen. The mobile shell keeps four
    // lists and the machine switcher mounted-but-hidden, and the switcher shipped
    // without the guard - so a phone named its machine twice.
    const componentsDir = join(process.cwd(), "src/client/src/components");
    const rendered = new Set<string>();
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.isFile() && entry.name.endsWith(".ts") && !entry.name.includes(".test.") ? [full] : [];
    });
    const files = walk(componentsDir);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/<([a-z][a-z0-9-]*-[a-z0-9-]+)([^>]*?)>/gs)) {
        const attrs = match[2] ?? "";
        if (/(^|\s)\?hidden=|(^|\s)hidden(\s|$)/.test(attrs)) rendered.add(match[1] ?? "");
      }
    }
    expect(rendered.size).toBeGreaterThan(0);

    for (const tag of rendered) {
      const defining = files.find((file) => readFileSync(file, "utf8").includes(`customElement("${tag}")`));
      expect(defining, `no component defines <${tag}>`).toBeDefined();
      const source = readFileSync(defining ?? "", "utf8");
      const usesSharedListSheet = source.includes("listStyles");
      const guardsItself = source.includes(":host([hidden])");
      expect(usesSharedListSheet || guardsItself, `<${tag}> is rendered with hidden but nothing makes hidden win`).toBe(true);
    }
  });
});