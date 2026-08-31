/**
 * src/server is organized by which process loads a module: web/ belongs to the
 * web/API process, daemon/ to the session daemon, shared/ to both. The layout
 * only stays truthful if the import graph respects it, so this asserts the
 * invariant at the import-shape level: web/ and daemon/ never import each
 * other, shared/ imports neither side, and each entry point stays on its own
 * side. Type-only imports count too — a type dependency still couples the
 * module to the other process's source tree.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const serverRoot = dirname(fileURLToPath(import.meta.url));

type Side = "web" | "daemon" | "shared" | "root";

function sideOf(file: string): Side {
  const rel = relative(serverRoot, file).split(sep);
  if (rel[0] === "web" || rel[0] === "daemon" || rel[0] === "shared") return rel[0];
  return "root";
}

/** Every relative import/export-from specifier of one module, type-only included. */
function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /import\s[^;]*?from\s*["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
    /import\s*["']([^"']+)["']/g,
    /export\s[^;]*?from\s*["']([^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier?.startsWith(".") === true) specifiers.push(specifier);
    }
  }
  return specifiers;
}

function resolveModuleFile(candidate: string): string | undefined {
  const paths = candidate.endsWith(".js")
    ? [candidate.slice(0, -3) + ".ts"]
    : [candidate + ".ts", join(candidate, "index.ts")];
  for (const path of paths) {
    try {
      readFileSync(path);
      return path;
    } catch {
      // not this candidate
    }
  }
  return undefined;
}

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (entry.name.endsWith(".ts") && !entry.name.includes(".test.")) files.push(path);
  }
  return files;
}

const FORBIDDEN: Record<Side, readonly Side[]> = {
  web: ["daemon"],
  daemon: ["web"],
  shared: ["web", "daemon"],
  root: [], // entries are checked individually below
};

describe("server process ownership", () => {
  it("keeps web/, daemon/, and shared/ from importing across process boundaries", () => {
    const violations: string[] = [];
    for (const file of sourceFiles(serverRoot)) {
      const from = sideOf(file);
      for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
        const target = resolveModuleFile(resolve(dirname(file), specifier));
        if (target === undefined) continue;
        const to = relative(serverRoot, target).startsWith("..") ? undefined : sideOf(target);
        if (to !== undefined && FORBIDDEN[from].includes(to)) {
          violations.push(`${relative(serverRoot, file)} -> ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps each entry point on its own side", () => {
    const entrySides = (entry: string): Set<Side> => {
      const sides = new Set<Side>();
      for (const specifier of importSpecifiers(readFileSync(join(serverRoot, entry), "utf8"))) {
        const target = resolveModuleFile(resolve(serverRoot, specifier));
        if (target !== undefined && !relative(serverRoot, target).startsWith("..")) sides.add(sideOf(target));
      }
      return sides;
    };
    expect(entrySides("index.ts").has("daemon")).toBe(false);
    expect(entrySides("sessiond.ts").has("web")).toBe(false);
  });
});
