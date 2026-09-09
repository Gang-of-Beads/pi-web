// @vitest-environment node

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The type scale (`--pi-text-2xs|xs|sm|base|md|lg|xl`) is published to every
 * shadow root, and a literal font size is a step outside it: a 10px eyebrow
 * that no token move can follow, an 18px glyph beside a 17px one, a 22px close
 * control next to a 20px one. Ninety-seven declarations named their size in
 * pixels before this test existed.
 *
 * `font:` shorthands that carry a token (`font: var(--pi-text-sm)/1.25 ...`)
 * are on the scale by construction and are not matched here; a shorthand with
 * a pixel size is, and should be.
 */
const ROOTS = ["src/client/src", "pi-web-plugins"];
const TYPE_LITERAL = /font-size:\s*\d+px/gu;
/** A `font:` shorthand states a size too; 16px and 10px escaped the scale there. */
const SHORTHAND_LITERAL = /font:\s*(?:\d+\s+)?\d+px/gu;
/** The ring width is a token; sixteen rules spelled it 2px and would not follow a change. */
const FOCUS_RING_LITERAL = /outline:\s*\d+px/gu;
/**
 * Two ramps whose literals kept coming back after each sweep: a weight the
 * scale names (400/500/600/650/700) and the single "cannot be used now"
 * opacity. Three rounds fixed the instances a lane happened to read; this
 * fails on the ones nobody read.
 */
const WEIGHT_LITERAL = /font-weight:\s*(?:400|500|600|650|700)\b/gu;
const DISABLED_OPACITY_LITERAL = /:disabled[^{]*\{[^}]*opacity:\s*\.\d+/gu;

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

describe("the type scale", () => {
  it("is the only source of font sizes in client surfaces", () => {
    const offences: string[] = [];
    for (const root of ROOTS) {
      for (const file of styleSources(root)) {
        const source = readFileSync(file, "utf8");
        for (const match of source.matchAll(TYPE_LITERAL)) offences.push(`${file}: ${match[0]}`);
        for (const match of source.matchAll(SHORTHAND_LITERAL)) offences.push(`${file}: ${match[0]}`);
      }
    }

    expect(offences).toEqual([]);
  });

  it("keeps the focus ring on its own token", () => {
    const offences: string[] = [];
    for (const root of ROOTS) {
      for (const file of styleSources(root)) {
        for (const match of readFileSync(file, "utf8").matchAll(FOCUS_RING_LITERAL)) offences.push(`${file}: ${match[0]}`);
      }
    }

    expect(offences).toEqual([]);
  });

  it("keeps weights and the disabled state on their ramps", () => {
    const offences: string[] = [];
    for (const root of ROOTS) {
      for (const file of styleSources(root)) {
        const source = readFileSync(file, "utf8");
        for (const match of source.matchAll(WEIGHT_LITERAL)) offences.push(`${file}: ${match[0]}`);
        for (const match of source.matchAll(DISABLED_OPACITY_LITERAL)) offences.push(`${file}: ${match[0].slice(0, 60)}`);
      }
    }

    expect(offences).toEqual([]);
  });
});
