// @vitest-environment node

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Control heights are a published scale (`--pi-control-height` 32,
 * `--pi-control-height-comfort` 36, `--pi-control-height-touch` 44). Leaving
 * the middle step unnamed is how 30, 34, 36, 38 and 40 all shipped as the same
 * intention: a search field 6px shorter than the one in the next dialog, a
 * model chip taller than the icon buttons beside it, a row menu 26px where its
 * sibling was 44px.
 *
 * A control-sized literal is therefore a defect by construction. Text metrics
 * are not controls and carry their own exemptions with the reason recorded
 * here; icons and marks (below the control range) are untouched.
 */
const ROOTS = ["src/client/src", "pi-web-plugins"];
const CONTROL_RANGE = /(?:min-)?(?:height|width):\s*(2[89]|3\d|4[0-4])px/gu;

/** Content metrics, not controls: the composer grows with the text in it. */
const EXEMPTIONS = new Map<string, string>([
  ["src/client/src/components/PromptEditor.ts", "textarea and CodeMirror content heights are line metrics, not control geometry"],
]);

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

describe("the control height scale", () => {
  it("is the only source of control-sized geometry", () => {
    const offences: string[] = [];
    for (const root of ROOTS) {
      for (const file of styleSources(root)) {
        if (EXEMPTIONS.has(file)) continue;
        for (const match of readFileSync(file, "utf8").matchAll(CONTROL_RANGE)) offences.push(`${file}: ${match[0]}`);
      }
    }

    expect(offences).toEqual([]);
  });

  it("records why an exempt file may still declare one", () => {
    for (const [file, reason] of EXEMPTIONS) {
      expect(reason.length).toBeGreaterThan(20);
      expect(styleSources(file.split("/").slice(0, -1).join("/"))).toContain(file);
    }
  });
});
