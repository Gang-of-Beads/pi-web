/**
 * Hover is a device capability, not a UI state. On a coarse pointer there is
 * no hover: the first touch dispatches it anyway, and when that changes how
 * the element looks, the browser withholds the click and demands a second
 * tap — the owner answered one dialog option six times before the cause was
 * found. The house rule is therefore absolute: a `:hover` selector may only
 * appear inside `@media (hover: hover)`, touch feedback uses `:active`, and
 * keyboard focus uses `:focus-visible`.
 *
 * This walks the client source and asserts the invariant at the source level:
 * every `:hover` occurrence must be preceded, on its own line, by the media
 * guard. A bare `:hover` anywhere fails here, so the rule cannot quietly grow
 * back in one file while the others stay clean.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const clientRoot = fileURLToPath(new URL(".", import.meta.url));

function* clientSourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* clientSourceFiles(path);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) yield path;
  }
}

/** Lines carrying a `:hover` that no `(hover: hover)` guard precedes on the same line. */
function unguardedHoverLines(): string[] {
  const violations: string[] = [];
  for (const path of clientSourceFiles(clientRoot)) {
    const lines = readFileSync(path, "utf8").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      let from = 0;
      for (;;) {
        const at = line.indexOf(":hover", from);
        if (at === -1) break;
        if (!line.slice(0, at).includes("(hover: hover)")) {
          violations.push(`${path}:${String(index + 1)}: ${line.trim()}`);
        }
        from = at + 1;
      }
    }
  }
  return violations;
}

describe("the hover house rule", () => {
  it("keeps every :hover selector behind @media (hover: hover)", () => {
    expect(unguardedHoverLines()).toEqual([]);
  });
});
