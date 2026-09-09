// @vitest-environment node

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A `var(--pi-…)` that nothing defines is not a missing colour: the whole
 * declaration is invalid at computed-value time, so the rule silently loses
 * the property it was written for. Three separate instances shipped and were
 * only found by reading — a failed command receipt that named `--pi-error*`
 * and lost both its danger colour and the fill its pending sibling keeps, an
 * activity dock whose "waiting for you" and "failed" states named
 * `--pi-*-bg-overlay` and lost their wash, and a rename dialog painted with
 * `--pi-bg-raised`. Every guard passed each time, because the syntax is
 * perfect.
 *
 * The definition sources are the app's own token block, the theme contract
 * (a theme may supply any `ThemeToken`), custom properties a component defines
 * for itself, and properties the app sets at runtime through `setProperty`.
 * A reference outside all of those is a defect unless it carries a fallback:
 * `var(--pi-border-strong, var(--pi-muted))` states its own answer for a theme
 * that does not supply the optional token, which is exactly the contract the
 * broken ones were missing.
 */
const ROOTS = ["src/client/src", "pi-web-plugins"];
const REFERENCE = /var\(\s*(--pi-[a-z0-9-]+)\s*(,?)/gu;
const DEFINITION = /(--pi-[a-z0-9-]+)\s*:/gu;
const RUNTIME_PROPERTY = /setProperty\(\s*["'](--pi-[a-z0-9-]+)["']/gu;

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

function definedNames(): Set<string> {
  const defined = new Set<string>();
  const collect = (source: string): void => {
    for (const match of source.matchAll(DEFINITION)) { const name = match[1]; if (name !== undefined) defined.add(name); }
    for (const match of source.matchAll(RUNTIME_PROPERTY)) { const name = match[1]; if (name !== undefined) defined.add(name); }
  };
  collect(readFileSync("src/client/index.html", "utf8"));
  collect(readFileSync("src/shared/pluginApiTypes.ts", "utf8"));
  for (const root of ROOTS) for (const file of styleSources(root)) collect(readFileSync(file, "utf8"));
  return defined;
}

describe("design token references", () => {
  it("only name tokens something defines", () => {
    const defined = definedNames();
    const offences = new Set<string>();
    for (const root of ROOTS) {
      for (const file of styleSources(root)) {
        for (const match of readFileSync(file, "utf8").matchAll(REFERENCE)) {
          const name = match[1];
          if (name === undefined || match[2] === ",") continue;
          if (!defined.has(name)) offences.add(`${file}: ${name}`);
        }
      }
    }

    expect([...offences]).toEqual([]);
  });
});
