/**
 * Every module specifier a browser plugin file names, in every form the browser resolves.
 *
 * The plugin build decides whether an entry must be bundled by walking these, and the
 * shipped-entry guard walks the same list to prove nothing unresolvable ships. They used to
 * carry separate regexes that each missed forms - a side-effect `import "./element.js"`, a
 * second import on the same line, a dynamic `import("…")` - and every miss had the same
 * outcome: a plugin that silently never activates while the guard stays green. One scanner
 * means the build and the guard cannot disagree about what a file imports.
 */
const STATIC = /(?:^|[;\n}])\s*(?:import|export)\s(?:[^;"'`]*?\sfrom\s*)?["']([^"']+)["']/gu;
const DYNAMIC = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu;

export function moduleSpecifiers(source) {
  return [...source.matchAll(STATIC), ...source.matchAll(DYNAMIC)].map((match) => match[1] ?? "").filter((specifier) => specifier !== "");
}

export function isRelativeSpecifier(specifier) {
  return specifier.startsWith("./") || specifier.startsWith("../");
}
