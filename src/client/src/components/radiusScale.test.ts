// @vitest-environment node

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Corner radii are a published scale (`--pi-radius-xs|sm|md|lg|xl|pill` in
 * src/client/index.html), and for a while the literals beat the tokens: 8px
 * appeared 44 times, and the off-scale values 5, 7, 10 and 14 together
 * appeared more often than `var(--pi-radius-lg)` was referenced at all. Four
 * curvatures could stack inside one dialog, and changing a token moved about
 * half the app's corners.
 *
 * Review cannot hold this line; a test can. Every radius a client surface
 * declares must come from the scale, so a new literal fails here instead of
 * shipping as the next visual inconsistency. Percentage radii (a circle) and
 * `inherit` are not scale values and stay allowed.
 */
const ROOTS = ["src/client/src", "pi-web-plugins"];
const RADIUS_LITERAL = /border(?:-[a-z]+)*-radius:\s*[^;{}]*\b\d+px/gu;

function styleSources(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "dist") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith(".ts")) continue;
      if (entry.endsWith(".test.ts")) continue;
      found.push(full);
    }
  };
  walk(root);
  return found;
}

describe("the corner radius scale", () => {
  it("is the only source of radii in client surfaces", () => {
    const offences: string[] = [];
    for (const root of ROOTS) {
      for (const file of styleSources(root)) {
        const source = readFileSync(file, "utf8");
        for (const line of source.split("\n")) {
          for (const match of line.matchAll(RADIUS_LITERAL)) offences.push(`${file}: ${match[0].trim()}`);
        }
      }
    }

    expect(offences).toEqual([]);
  });
});
