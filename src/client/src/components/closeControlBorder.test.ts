import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every chrome control wears a border.
 *
 * The owner has reported unboxed glyphs three times - the message info key,
 * and then the close key on the prompt-history sheet - because each surface
 * decided for itself whether its close button was decoration or a control. On
 * a phone an outline is what tells a glyph apart from a stray mark, so the
 * rule is asserted for every close control in the directory rather than per
 * component.
 */

const componentsDir = dirname(fileURLToPath(import.meta.url));

function componentFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...componentFiles(path));
      continue;
    }
    if (!entry.endsWith(".ts") || entry.endsWith(".test.ts") || entry.endsWith(".d.ts")) continue;
    found.push(path);
  }
  return found;
}

/** The declaration block a `.close`/`.close-button` rule opens, if any. */
function closeControlBlocks(source: string): string[] {
  const blocks: string[] = [];
  const pattern = /\.(?:close|close-button|sheet-close)\s*\{/gu;
  let match = pattern.exec(source);
  while (match !== null) {
    const end = source.indexOf("}", match.index);
    if (end !== -1) blocks.push(source.slice(match.index, end));
    match = pattern.exec(source);
  }
  return blocks;
}

describe("close controls are bordered", () => {
  it("never declares a borderless close control", () => {
    const offenders: string[] = [];
    for (const file of componentFiles(componentsDir)) {
      for (const block of closeControlBlocks(readFileSync(file, "utf8"))) {
        if (/border:\s*(?:0|none)\s*;/u.test(block)) offenders.push(file.slice(componentsDir.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });
});
