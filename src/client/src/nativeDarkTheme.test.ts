import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CORE_PRO_DARK_TOKENS } from "./nativeDarkTheme";
import { CORE_PRO_LIGHT_TOKENS } from "./nativeLightTheme";

/**
 * A picked look must outrank the system preference, which means the dark side
 * has to set the values the light `prefers-color-scheme` block would otherwise
 * win with. The guard keeps this copy equal to the stylesheet's base block for
 * exactly those tokens.
 */
function baseDarkTokens(): Record<string, string> {
  const html = readFileSync("src/client/index.html", "utf-8");
  const start = html.indexOf(":root {");
  const end = html.indexOf("@media (prefers-color-scheme: light)");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const tokens: Record<string, string> = {};
  for (const match of html.slice(start, end).matchAll(/(--pi-[a-z0-9-]+):\s*([^;]+);/gu)) {
    const name = match[1];
    const value = match[2];
    if (name === undefined || value === undefined) continue;
    tokens[name] = value.trim();
  }
  return tokens;
}

describe("the native dark palette", () => {
  it("covers every token the light block would otherwise override", () => {
    expect(Object.keys(CORE_PRO_DARK_TOKENS).sort()).toEqual(Object.keys(CORE_PRO_LIGHT_TOKENS).sort());
  });

  it("matches the stylesheet's base values", () => {
    const base = baseDarkTokens();
    for (const [name, value] of Object.entries(CORE_PRO_DARK_TOKENS)) {
      expect(base[name], `${name} drifted from index.html`).toBe(value);
    }
  });
});
