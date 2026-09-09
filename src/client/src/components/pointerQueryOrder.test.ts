// @vitest-environment node

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A media query carries no extra specificity. A `(pointer: coarse)` floor
 * written before a base rule with the same selector loses to it, silently, and
 * the surface ships the mouse size on a phone: row menu items measured 36px
 * against a declared 44, and the rename actions the same.
 *
 * shared.ts had even written the incident down three lines above the rule that
 * repeated it. A comment does not hold; this does: within one styles template,
 * a selector raised inside a pointer/hover media query must not be declared
 * again at the base level after that query.
 */
const ROOTS = ["src/client/src", "pi-web-plugins"];
const MEDIA_BLOCK = /@media\s*\((?:pointer|hover):[^)]*\)\s*\{/gu;
const SELECTOR = /(?:^|\})\s*(?<selector>[.#][\w-][^{}@]*?)\s*\{/gu;

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

function blockEnd(source: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return source.length;
}

function declaredProperties(source: string, from: number): Set<string> {
  const open = source.indexOf("{", from);
  const body = source.slice(open + 1, blockEnd(source, open));
  const names = new Set<string>();
  for (const declaration of body.matchAll(/(?:^|;|\{)\s*(?<name>[a-z-]+)\s*:/gu)) names.add(declaration.groups?.["name"] ?? "");
  return names;
}

describe("pointer media queries", () => {
  it("are not undone by a later base rule with the same selector", () => {
    const offences: string[] = [];
    for (const root of ROOTS) {
      for (const file of styleSources(root)) {
        const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//gu, " ");
        for (const media of source.matchAll(MEDIA_BLOCK)) {
          const open = media.index + media[0].length - 1;
          const end = blockEnd(source, open);
          const inside = source.slice(open, end);
          const after = source.slice(end);
          for (const raised of inside.matchAll(SELECTOR)) {
            const selector = (raised.groups?.["selector"] ?? "").replace(/\s+/gu, " ").trim();
            if (selector === "" || selector.includes("@")) continue;
            const repeated = new RegExp(`(?:^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\s*\\{`, "u");
            const raisedProps = declaredProperties(inside, raised.index);
            const laterMatch = repeated.exec(after);
            if (laterMatch === null) continue;
            const laterProps = declaredProperties(after, laterMatch.index);
            if (![...raisedProps].some((property) => laterProps.has(property))) continue;
            offences.push(`${file}: ${selector}`);
          }
        }
      }
    }

    expect(offences).toEqual([]);
  });
});
