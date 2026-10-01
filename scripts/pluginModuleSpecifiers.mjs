/**
 * Every module specifier a browser plugin file names, in every form the browser resolves.
 *
 * The shipped-entry guards (`pi-web-plugins/browserEntryResolvable.test.ts`) walk these to prove
 * that a built entry is one module and carries nothing unresolvable. The regexes used to miss
 * forms - a side-effect `import "./element.js"`, a second import on the same line, a dynamic
 * `import("…")` - and every miss had the same outcome: a plugin that silently never activates
 * while the guard stays green.
 */
const STATIC = /(?:^|[;\n}])\s*(?:import|export)\s(?:[^;"'`]*?\sfrom\s*)?["']([^"']+)["']/gu;
const DYNAMIC = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu;

export function moduleSpecifiers(source) {
  return [...source.matchAll(STATIC), ...source.matchAll(DYNAMIC)].map((match) => match[1] ?? "").filter((specifier) => specifier !== "");
}

/** The specifiers a file loads before it runs: its static and side-effect imports, not its lazy `import()`s. */
export function staticModuleSpecifiers(source) {
  return [...source.matchAll(STATIC)].map((match) => match[1] ?? "").filter((specifier) => specifier !== "");
}

export function isRelativeSpecifier(specifier) {
  return specifier.startsWith("./") || specifier.startsWith("../");
}
