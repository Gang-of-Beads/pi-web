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

/**
 * Declaration blocks a close-control rule opens, split into the base rule and
 * its state variants: `:hover`/`:focus-visible`/media overrides legitimately
 * say nothing about the border, so only the base rule has to draw one.
 */
function closeControlBlocks(source: string): { base: string[]; all: string[] } {
  const base: string[] = [];
  const all: string[] = [];
  const pattern = /(?:^|[\s,>])\.(?:close|close-button|sheet-close)(?![\w-])([^{,;()]{0,40}?)\{/gu;
  let match = pattern.exec(source);
  while (match !== null) {
    const end = source.indexOf("}", match.index);
    if (end !== -1) {
      const block = source.slice(match.index, end);
      all.push(block);
      if ((match[1] ?? "").trim() === "") base.push(block);
    }
    match = pattern.exec(source);
  }
  return { base, all };
}

/** Whether a block draws a border rather than merely not disowning one. */
function drawsBorder(block: string): boolean {
  if (/border(?:-top)?(?:-width)?:\s*(?:0(?:px)?|none)\b/u.test(block)) return false;
  return /border(?:-top)?:\s*[^;]*\b(?:solid|dashed|dotted)\b/u.test(block) || /border-width:\s*[^;]*[1-9]/u.test(block);
}

describe("close controls are bordered", () => {
  it("draws a border on every close control, rather than merely not disowning one", () => {
    const offenders: string[] = [];
    let inspected = 0;
    for (const file of componentFiles(componentsDir)) {
      const blocks = closeControlBlocks(readFileSync(file, "utf8"));
      if (blocks.all.length === 0) continue;
      inspected += 1;
      const disowned = blocks.all.some((block) => /border(?:-top)?(?:-width)?:\s*(?:0(?:px)?|none)\b/u.test(block));
      if (disowned || !blocks.base.some((block) => drawsBorder(block))) offenders.push(file.slice(componentsDir.length + 1));
    }
    expect(inspected).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it("names a borderless control however it is spelled", () => {
    expect(drawsBorder(".close { border: 0; }")).toBe(false);
    expect(drawsBorder(".close { border: 0px }")).toBe(false);
    expect(drawsBorder(".close { border-width: 0 }")).toBe(false);
    expect(drawsBorder(".close { border: none }")).toBe(false);
    expect(drawsBorder(".close { padding: 0 }")).toBe(false);
    expect(drawsBorder(".close { border: 1px solid var(--pi-border); }")).toBe(true);
  });
});
