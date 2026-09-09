// @vitest-environment node

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Spacing is a published scale (`--pi-space-1..9`, 2/4/6/8/10/12/16/20/24px),
 * and 582 declarations named their gaps in pixels instead — including steps
 * the scale does not have (3, 5, 7, 9, 14), which is how two sibling rows end
 * up breathing differently for no stated reason.
 *
 * Values that mix spacing with layout maths or device insets (`calc(...)`,
 * `env(safe-area-inset-*)`, `min()`, `max()`, `clamp()`) are exempt: those
 * express a position, not a step on the rhythm, and rewriting them mechanically
 * would change what they compute. A pixel value above the scale's top step
 * (24px) is likewise structural - it reserves room for a control that overlays
 * the box (a 44px menu button, a 58px composer gutter) and belongs to the
 * control's size, not to the rhythm. Both exemptions are narrow and stated
 * here so a plain rhythm literal cannot hide behind them.
 */
const ROOTS = ["src/client/src", "pi-web-plugins"];
const SPACING_PROPERTY = /\b(?:padding|margin|gap|row-gap|column-gap|padding-(?:top|right|bottom|left|inline|block)|margin-(?:top|right|bottom|left|inline|block)):\s*([^;{}]+)/gu;
const COMPUTED_VALUE = /calc\(|env\(|min\(|max\(|clamp\(/u;
const RHYTHM_TOP = 24;

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

describe("the spacing scale", () => {
  it("is the only source of plain spacing values", () => {
    const offences: string[] = [];
    for (const root of ROOTS) {
      for (const file of styleSources(root)) {
        for (const match of readFileSync(file, "utf8").matchAll(SPACING_PROPERTY)) {
          const value = match[1] ?? "";
          if (COMPUTED_VALUE.test(value)) continue;
          for (const step of value.matchAll(/(?:^|\s)(\d+)px(?=\s|$)/gu)) {
            if (Number(step[1]) <= RHYTHM_TOP) offences.push(`${file}: ${match[0].trim()}`);
          }
        }
      }
    }

    expect(offences).toEqual([]);
  });
});
