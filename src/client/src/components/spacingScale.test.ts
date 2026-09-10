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
 * Values that mix spacing with layout maths or device insets are inspected
 * inside the maths rather than skipped: `max(12px, env(safe-area-inset-top))`
 * still names a rhythm step, and skipping the whole declaration is how a
 * cluster of bare 12/6/14/18px values sat inside `@media (pointer: coarse)`
 * untouched. Only the non-literal parts (`env(...)`, viewport units, other
 * variables) are outside the scale's jurisdiction. Negative offsets count too:
 * a `-8px` margin is the same step spelled backwards. Offsets count too: a
 * badge placed with `top: 6px` is spacing spelled as a position, and round
 * eight found four such literals living outside the guard's window.
 *
 * A pixel value above the scale's top step (24px) is structural - it reserves
 * room for a control that overlays the box (a 44px menu button, a 58px
 * composer gutter) and belongs to the control's size, not to the rhythm.
 */
const ROOTS = ["src/client/src", "pi-web-plugins"];
const SPACING_PROPERTY = /(?<![-\w])(?:padding|margin|gap|row-gap|column-gap|padding-(?:top|right|bottom|left|inline|block|inline-start|inline-end|block-start|block-end)|margin-(?:top|right|bottom|left|inline|block|inline-start|inline-end|block-start|block-end)|top|right|bottom|left|inset|inset-(?:inline|block)):\s*([^;{}]+)/gu;
const RHYTHM_TOP = 24;
const HAIRLINE = 1;
/**
 * Values that are deliberately between steps: the asymmetric trims that keep a
 * hit box off its neighbour, and the terminal's own cell padding. They are
 * named here so a new one has to be argued for rather than typed.
 */
const OFF_SCALE_TRIMS = new Set([3, 5]);

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
          for (const step of value.matchAll(/(-?)(\d+)px/gu)) {
            const size = Number(step[2]);
            if (size > RHYTHM_TOP || size <= HAIRLINE) continue;
            if (OFF_SCALE_TRIMS.has(size)) continue;
            offences.push(`${file}: ${match[0].trim()}`);
          }
        }
      }
    }

    expect(offences).toEqual([]);
  });
});
