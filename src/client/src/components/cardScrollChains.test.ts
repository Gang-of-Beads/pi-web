import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A region drawn in the transcript chains the wheel and a swipe to the transcript at its end
 * (state-diagram D2, B11). The owner reported a wheel over a card that scrolled nothing: the dialog
 * detail region declared `overscroll-behavior: contain`, which D2 keeps for overlays. Horizontal
 * containment stays: on a code block it keeps a sideways swipe from going Back.
 *
 * Drawn in the transcript: ChatView and every component it imports, and every file of a plugin that
 * contributes a message or code-fence renderer (review 1c0cb377: a fixed list of four files missed
 * the message text and the plugins' renderers).
 */
const componentsDir = dirname(fileURLToPath(import.meta.url));
const pluginsDir = join(componentsDir, "..", "..", "..", "..", "pi-web-plugins");
const verticalContainment = /overscroll-behavior(?:(?:-y|-block)?\s*:\s*(?:contain|none)\s*[;}\n]|\s*:\s*[\w-]+\s+(?:contain|none))/gu;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (entry === "node_modules" || entry === "dist") return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".d.ts") ? [path] : [];
  });
}

const chatView = join(componentsDir, "ChatView.ts");
const chatViewImports = [...new Set([...readFileSync(chatView, "utf8").matchAll(/(?:from\s+|import\s+)"\.\/([A-Za-z]+)(?:\.js)?"/gu)].map((match) => match[1] ?? ""))].map((name) => join(componentsDir, `${name}.ts`));
const rendererPlugins = readdirSync(pluginsDir)
  .map((entry) => join(pluginsDir, entry))
  .filter((dir) => existsSync(join(dir, "pi-web-plugin.ts")) && /messageRenderers|codeFenceRenderers/u.test(readFileSync(join(dir, "pi-web-plugin.ts"), "utf8")));
const drawnInTheTranscript = [...new Set([chatView, ...chatViewImports, ...rendererPlugins.flatMap(sourceFiles)])];

describe("regions drawn in the transcript chain to it", () => {
  /** Review ca45d6ed: a pattern that missed side-effect imports dropped the cards themselves while a count still passed. */
  it("finds the cards, the message text and the renderer plugins it guards", () => {
    const named = (path: string) => path.slice(path.lastIndexOf("/") + 1);
    expect({
      components: ["AskUserCard.ts", "ExtensionDialogCard.ts", "FormattedText.ts", "ToolExecutionView.ts"].filter((name) => !drawnInTheTranscript.map(named).includes(name)),
      plugins: rendererPlugins.length > 0,
    }).toEqual({ components: [], plugins: true });
  });

  it.each(drawnInTheTranscript.map((path) => [path.slice(path.includes("/src/") ? path.indexOf("/src/") + 1 : path.indexOf("/pi-web-plugins/") + 1), path]))("%s declares no vertical overscroll containment", (_name, path) => {
    expect(readFileSync(path, "utf8").match(verticalContainment) ?? []).toEqual([]);
  });

  it.each([
    ["overscroll-behavior: contain;", true],
    ["overscroll-behavior-y: none;", true],
    ["overscroll-behavior: auto contain;", true],
    ["overscroll-behavior-x: contain;", false],
    ["overscroll-behavior: contain auto;", false],
  ])("reads %s as vertical containment: %s", (rule, vertical) => {
    expect(new RegExp(verticalContainment.source, "u").test(rule)).toBe(vertical);
  });
});
