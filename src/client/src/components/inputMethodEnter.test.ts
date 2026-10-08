import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { keyBelongsToInputMethod } from "./keyboardEventTarget";

/**
 * Every Enter handler lets the input method keep its key.
 *
 * User report (2026-09-30): with a Chinese IME on desktop, every Enter that picked a word
 * sent the message. The composer was the one reported, but every search field, picker and
 * dialog that acts on Enter had the same hole, so the rule is asserted over every source
 * file that reads the Enter key. A file on the list below handles Enter only on controls
 * an input method cannot type into, or holds a pure model whose caller checks.
 */

const clientDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const pluginsDir = join(clientDir, "..", "..", "..", "pi-web-plugins");

const NOT_A_TEXT_FIELD: Readonly<Record<string, string>> = {
  "src/client/src/components/ChatView.ts": "Enter opens an image tile, a role=button",
  "src/client/src/components/selectableRow.ts": "row activation defers to inputs inside the row",
  "pi-web-plugins/workspaces/browser/selectableRow.ts": "row activation defers to inputs inside the row",
  "src/client/src/sessionTreeModel.ts": "a pure key model; SessionTreeNavigator checks before calling it",
};

const READS_ENTER = /key\s*[!=]==\s*"Enter"|case\s+"Enter"/;

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".d.ts") && !/testsupport/i.test(entry)) found.push(path);
  }
  return found;
}

const repoRoot = join(clientDir, "..", "..", "..");
const enterReaders = [...sourceFiles(clientDir), ...sourceFiles(pluginsDir)]
  .filter((path) => READS_ENTER.test(readFileSync(path, "utf8")))
  .map((path) => relative(repoRoot, path).split(sep).join("/"));

describe("Enter handlers and input methods", () => {
  it("precondition: the scan finds the composer and the pickers", () => {
    expect(enterReaders).toEqual(expect.arrayContaining([
      "src/client/src/components/PromptEditor.ts",
      "src/client/src/components/QuickSwitcher.ts",
      "pi-web-plugins/workspaces/browser/ProjectDialog.ts",
    ]));
  });

  it("every file that acts on Enter checks whether the input method owns the key", () => {
    const unchecked = enterReaders
      .filter((path) => NOT_A_TEXT_FIELD[path] === undefined)
      .filter((path) => !readFileSync(join(repoRoot, path), "utf8").includes("keyBelongsToInputMethod("));
    expect(unchecked).toEqual([]);
  });

  it("the exemption list names only files that still read Enter", () => {
    expect(Object.keys(NOT_A_TEXT_FIELD).filter((path) => !enterReaders.includes(path))).toEqual([]);
  });

  it.each([
    { name: "a composing Enter", event: { isComposing: true, keyCode: 229 }, owned: true },
    { name: "the confirming Enter after compositionend", event: { isComposing: false, keyCode: 229 }, owned: true },
    { name: "a plain Enter", event: { isComposing: false, keyCode: 13 }, owned: false },
  ])("$name belongs to the input method: $owned", ({ event, owned }) => {
    expect(keyBelongsToInputMethod(event)).toBe(owned);
  });
});
