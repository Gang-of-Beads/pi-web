// @vitest-environment node

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A control that states a size and a border, and does not state its box model,
 * does not measure what its token says. Three separate defects shipped in that
 * exact shape - a state ring drawn 12px from an 8px token, seven dialog close
 * controls drawn 34px from a 32px token, a rename action 2px larger than its
 * neighbours - and every scale guard passed each time, because the token in the
 * declaration was correct.
 *
 * The rule: within one CSS rule, both a width and a height plus a visible
 * `border` shorthand requires
 * `box-sizing`. Percentage and `auto` sizes are not control geometry and are
 * left alone; a border declared as `border: 0`/`none` paints nothing.
 */
const ROOTS = ["src/client/src", "pi-web-plugins"];
const RULE = /\{[^{}]*\}/gu;
const WIDTH = /(?:^|;|\s)(?:width|min-width):\s*(?!auto|100%|0\b)[^;]+/u;
const HEIGHT = /(?:^|;|\s)(?:height|min-height):\s*(?!auto|100%|0\b)[^;]+/u;
const BORDERED = /(?:^|;|\s)border:\s*(?!0\b|none)[^;]+/u;
const BOX_SIZED = "box-sizing:";

function styleSources(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "dist") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) found.push(full);
    }
  };
  walk(root);
  return found;
}

describe("controls that state a size and a border", () => {
  it("state their box model too", () => {
    const offences: string[] = [];
    for (const root of ROOTS) {
      for (const file of styleSources(root)) {
        const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//gu, " ");
        for (const match of source.matchAll(RULE)) {
          const rule = match[0];
          if (!WIDTH.test(rule) || !HEIGHT.test(rule)) continue;
          if (!BORDERED.test(rule) || rule.includes(BOX_SIZED)) continue;
          offences.push(`${file}: ${rule.replace(/\s+/gu, " ").slice(0, 90)}`);
        }
      }
    }

    expect(offences).toEqual([]);
  });
});
