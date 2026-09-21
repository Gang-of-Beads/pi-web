import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CORE_PRO_LIGHT_TOKENS } from "./nativeLightTheme";

/**
 * Two copies of the light palette exist on purpose: index.html paints before
 * any JavaScript runs, and the picked theme is applied from TypeScript. They
 * must be the same palette, so this guard reads the stylesheet and compares.
 */
function indexLightTokens(): Record<string, string> {
  const html = readFileSync("src/client/index.html", "utf-8");
  const start = html.indexOf("@media (prefers-color-scheme: light)");
  expect(start).toBeGreaterThan(-1);
  const block = html.slice(start, html.indexOf("html, body { margin: 0;", start));
  const tokens: Record<string, string> = {};
  for (const match of block.matchAll(/(--pi-[a-z0-9-]+):\s*([^;]+);/gu)) {
    const name = match[1];
    const value = match[2];
    if (name === undefined || value === undefined) continue;
    tokens[name] = value.trim();
  }
  return tokens;
}

describe("the native light palette", () => {
  it("matches the stylesheet's prefers-color-scheme block exactly", () => {
    expect(CORE_PRO_LIGHT_TOKENS).toEqual(indexLightTokens());
  });

  it("carries the colours the icon and the text need", () => {
    expect(CORE_PRO_LIGHT_TOKENS["--pi-bg"]).toBe("#f6f5f2");
    expect(CORE_PRO_LIGHT_TOKENS["--pi-accent"]).toBeDefined();
    expect(CORE_PRO_LIGHT_TOKENS["--pi-text"]).toBeDefined();
  });
});
