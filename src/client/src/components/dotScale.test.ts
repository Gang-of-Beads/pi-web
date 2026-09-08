// @vitest-environment node

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A dot is one motif: "this is working", "this is its state". It shipped at
 * 4, 5, 6, 7 and 8px with 2px and 3px gaps, so a single screen could bounce a
 * 6px triplet in the context bar above a 4px triplet in the activity dock,
 * beside a 7px mark in the status bar and an 8px one in the drawer. The scale
 * (`--pi-dot-xs|sm|md`) is now the only source, and this test is what keeps a
 * sixth size from appearing.
 */
const ROOTS = ["src/client/src", "pi-web-plugins"];

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

function marksInLine(line: string): string[] {
  const round = line.includes("border-radius: 50%") || line.includes("border-radius: var(--pi-radius-pill)");
  const named = /activity-indicator|state-dot|working-dot|row-flag|\.dot\b/u.test(line);
  if (!round && !named) return [];
  return [...line.matchAll(/(?:width|height):\s*(\d)px/gu)].map((match) => match[0]);
}

describe("the state dot scale", () => {
  it("is the only source of dot geometry", () => {
    const offences: string[] = [];
    for (const root of ROOTS) {
      for (const file of styleSources(root)) {
        for (const line of readFileSync(file, "utf8").split("\n")) {
          for (const mark of marksInLine(line)) offences.push(`${file}: ${mark}`);
        }
      }
    }

    expect(offences).toEqual([]);
  });

  it("keeps the scale itself published", () => {
    const tokens = readFileSync("src/client/index.html", "utf8");
    expect(tokens).toContain("--pi-dot-xs:");
    expect(tokens).toContain("--pi-dot-sm:");
    expect(tokens).toContain("--pi-dot-md:");
  });
});
