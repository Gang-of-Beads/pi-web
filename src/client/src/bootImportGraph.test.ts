/**
 * The composer's editor ships with the page (owner, 2026-10-06). It was a
 * dynamic import fetched when the composer mounted, to keep 649KB of CodeMirror
 * off the first paint; one failed fetch of it then left the tab with no input
 * until a reload, because Chrome remembers a failed module import.
 *
 * This walks the static import graph from the client entrypoint and asserts
 * the invariant at the import-shape level: a runtime (non-type-only) edge in
 * the eager closure reaches the editor setup module and CodeMirror. Type-only
 * imports are erased at build time and do not count.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const entryPath = fileURLToPath(new URL("./main.ts", import.meta.url));
const promptEditorPath = fileURLToPath(new URL("./components/PromptEditor.ts", import.meta.url));
const composerEditorSetupPath = fileURLToPath(new URL("./components/composerEditorSetup.ts", import.meta.url));

/** Runtime import/export-from specifiers of one module: type-only imports are erased, so they are not edges. */
function runtimeImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /import\s+(?!type\s)[^;]*?from\s*["']([^"']+)["']/g,
    /import\s*["']([^"']+)["']/g,
    /export\s+(?!type\s)[^;]*?from\s*["']([^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) specifiers.push(specifier);
    }
  }
  return specifiers;
}

/** Modules reachable from the entry through runtime imports, plus the bare specifiers they pull in. */
function eagerImportGraph(entry: string): { files: Set<string>; externals: Set<string> } {
  const files = new Set<string>();
  const externals = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined || files.has(file)) continue;
    files.add(file);
    for (const specifier of runtimeImportSpecifiers(readFileSync(file, "utf8"))) {
      if (!specifier.startsWith(".")) {
        externals.add(specifier);
        continue;
      }
      const moduleFile = resolveModuleFile(resolve(dirname(file), specifier));
      if (moduleFile !== undefined) queue.push(moduleFile);
    }
  }
  return { files, externals };
}

/** Same file TypeScript resolves: the exact path, with .ts, or as a directory index. */
function resolveModuleFile(target: string): string | undefined {
  if (existsSync(target) && statSync(target).isFile()) return target;
  if (existsSync(`${target}.ts`)) return `${target}.ts`;
  const index = `${target}/index.ts`;
  return existsSync(index) ? index : undefined;
}

describe("the eager client import graph", () => {
  it("reaches the composer, so the invariant below cannot pass vacuously", () => {
    const graph = eagerImportGraph(entryPath);

    expect(graph.files.has(promptEditorPath)).toBe(true);
    expect(graph.externals).toContain("lit");
  });

  it("carries the composer's editor in the first download", () => {
    const graph = eagerImportGraph(entryPath);

    const editorExternals = [...graph.externals].filter((specifier) => specifier.startsWith("@codemirror/"));
    expect(editorExternals).not.toEqual([]);
    expect(graph.files.has(composerEditorSetupPath)).toBe(true);
  });
});
