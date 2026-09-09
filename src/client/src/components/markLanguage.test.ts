// @vitest-environment node

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A mark is drawn, not typed.
 *
 * This family was reported in six separate rounds - ▸ ▾ ⧉ ↻ ↩ ✓ ✖ ▶ ↑ ↓ ☑ ⓘ ‹ ›
 * ＋ ⚑ - and each round's sweep fixed the producers it happened to read and
 * left siblings behind, because a character carries no evidence of being a
 * mark. A typed glyph takes its ink size, weight and baseline from whichever
 * font resolves it, so two of them side by side disagree and neither obeys the
 * icon scale.
 *
 * The rule this guard enforces is narrow on purpose: a glyph that is the whole
 * visible content of an element (or of a ternary that produces one) is a mark
 * and must come from `uiIcons.ts` or `disclosureIcon.ts`. A glyph inside a
 * sentence is prose - "✓ current", "✓ configured" - which is a product
 * question the owner owns, not something a sweep may rewrite.
 */
const ROOTS = ["src/client/src", "pi-web-plugins"];
const MARK_GLYPHS = "✓✔✖✗⧉↻↩◌●○▶▸▾⚑☑⟲‹›ⓘ⓵";
const ICON_SOURCES = new Set(["uiIcons.ts", "disclosureIcon.ts"]);

/** `>✓<`, `>${"\u2713"}<`, `? "▾" : "▸"` and `content: "ⓘ"` are all marks. */
const STANDALONE_PATTERNS = [
  new RegExp(`>\\s*[${MARK_GLYPHS}]\\s*<`, "u"),
  new RegExp(`["'\`]\\s*[${MARK_GLYPHS}]\\s*["'\`]`, "u"),
  new RegExp(`\\\\u(?:2713|2714|2716|2717|29c9|21bb|21a9|25cc|25cf|25cb|25b6|25b8|25be|2691|2611|27f2|2039|203a|24d8)`, "iu"),
];

function styleSources(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "dist") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith(".ts") || entry.endsWith(".test.ts") || ICON_SOURCES.has(entry)) continue;
      found.push(full);
    }
  };
  walk(root);
  return found;
}

function isComment(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*");
}

describe("marks", () => {
  it("are drawn from the icon modules, not typed as characters", () => {
    const offences: string[] = [];
    for (const root of ROOTS) {
      for (const file of styleSources(root)) {
        for (const [index, line] of readFileSync(file, "utf8").split("\n").entries()) {
          if (isComment(line)) continue;
          if (!STANDALONE_PATTERNS.some((pattern) => pattern.test(line))) continue;
          offences.push(`${file}:${String(index + 1)}: ${line.trim().slice(0, 90)}`);
        }
      }
    }

    expect(offences).toEqual([]);
  });
});
