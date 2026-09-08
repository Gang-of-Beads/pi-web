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
        for (const match of readFileSync(file, "utf8").matchAll(TYPE_LITERAL)) offences.push(`${file}: ${match[0]}`);
      }
    }

    expect(offences).toEqual([]);
  });
});
