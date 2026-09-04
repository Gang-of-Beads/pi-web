import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every component that draws a control must neutralise the platform's touch
 * affordances, and a shadow root gives it no way to inherit that.
 *
 * The owner reported the same symptom for the fourth time - "tapping a button
 * flashes a dark blue block" - because the declarations lived in whichever
 * component happened to remember them. This asserts the rule for the whole
 * directory instead, so the next component fails here rather than under a
 * thumb.
 */

// fileURLToPath, not URL.pathname: on Windows the latter yields "/C:/...",
// which no filesystem call accepts.
const componentsDir = dirname(fileURLToPath(import.meta.url));

function componentFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...componentFiles(path));
      continue;
    }
    if (!entry.endsWith(".ts")) continue;
    if (entry.endsWith(".test.ts") || entry.endsWith(".d.ts")) continue;
    found.push(path);
  }
  return found;
}

/** A file that styles interactive elements: it renders a control and owns CSS. */
function stylesInteractiveElements(source: string): boolean {
  const ownsStyles = source.includes("css`");
  if (!ownsStyles) return false;
  return /<button|<a\s|<summary|<select|<input|<textarea|role="button"|role="tab"|role="option"/u.test(source);
}

function satisfiesContract(source: string): boolean {
  if (source.includes("interactiveSurfaceStyles")) return true;
  // A component may still declare the rule itself; the contract is the
  // behaviour, not the import.
  return source.includes("-webkit-tap-highlight-color") && source.includes("touch-action");
}

describe("the touch contract every component owes", () => {
  const files = componentFiles(componentsDir);

  it("finds the component files to check", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("neutralises the tap highlight and the double-tap delay in every component that draws a control", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!stylesInteractiveElements(source)) continue;
      if (satisfiesContract(source)) continue;
      offenders.push(file.slice(componentsDir.length + 1));
    }

    expect(offenders, `components missing the touch contract:\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("the root neutralizes the UA tap highlight for every shadow root", () => {
  it("index.html carries the inherited rule", () => {
    const html = readFileSync(join(componentsDir, "..", "..", "index.html"), "utf8");
    expect(html).toContain("-webkit-tap-highlight-color: transparent");
  });
});
