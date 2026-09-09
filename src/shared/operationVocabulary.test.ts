// @vitest-environment node

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * One vocabulary for the middle state.
 *
 * The state between "the server answered" and "the server refused" had three
 * names at once: `unanswered` in the message lifecycle, "did not answer" in the
 * page banner, and `failed` on the delivery row. Three names for one state is
 * how a message the daemon was already running got shown as gone.
 *
 * The fixed word is `unverifiable`. This guard fails when a synonym reappears
 * in production code, and when a delivery row calls that state `failed`.
 */
const ROOTS = ["src/client/src", "src/server", "src/shared", "pi-web-plugins"];
const BANNED = [
  { word: "unanswered", instead: "unverifiable" },
  { word: "unacknowledged", instead: "unverifiable" },
  { word: "indeterminate", instead: "unverifiable" },
];
const ALLOWED_FILES = new Set(["operationSettlement.ts", "operationVocabulary.test.ts"]);

/**
 * Only settlement and delivery *states* are policed. A question a person has
 * not answered is a different fact with a legitimate name of its own; renaming
 * that would be the vocabulary rule eating its own tail.
 */
function namesAState(source: string, word: string): boolean {
  return new RegExp(`(?:state|outcome|settlement|delivery|status)\\s*[:=]\\s*["'\`]${word}["'\`]`, "u").test(source);
}

function sources(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "dist") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith(".ts") || entry.endsWith(".test.ts") || ALLOWED_FILES.has(entry)) continue;
      found.push(full);
    }
  };
  walk(root);
  return found;
}

describe("the settlement vocabulary", () => {
  it("has one word for the state between answered and refused", () => {
    const offences: string[] = [];
    for (const root of ROOTS) {
      for (const file of sources(root)) {
        const source = readFileSync(file, "utf8");
        for (const { word, instead } of BANNED) {
          if (namesAState(source, word)) offences.push(`${file}: names a state "${word}", the word is "${instead}"`);
        }
      }
    }

    expect(offences).toEqual([]);
  });
});
