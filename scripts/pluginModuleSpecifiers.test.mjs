import { describe, expect, it } from "vitest";
import { isRelativeSpecifier, moduleSpecifiers, staticModuleSpecifiers } from "./pluginModuleSpecifiers.mjs";

describe("staticModuleSpecifiers", () => {
  it("names what a file loads before it runs, not its lazy imports", () => {
    expect(staticModuleSpecifiers('import { a } from "./a.js";\nimport "./element.js";\nvoid import("./lazy.js");\nexport { b } from "./b.js";')).toEqual(["./a.js", "./element.js", "./b.js"]);
  });
});

describe("moduleSpecifiers", () => {
  it("finds named, side-effect and re-export imports", () => {
    const source = 'import { a } from "./a.js";\nimport "./element.js";\nexport * from "./b.js";\nexport { c } from "lit";';
    expect(moduleSpecifiers(source)).toEqual(["./a.js", "./element.js", "./b.js", "lit"]);
  });

  it("finds a second import on the same line", () => {
    expect(moduleSpecifiers('import { a } from "./x.js"; import { b } from "lit";')).toEqual(["./x.js", "lit"]);
  });

  it("finds dynamic imports, relative and bare", () => {
    expect(moduleSpecifiers('void import("./codeViewerElement.js");\nconst m = await import ( "lit" );')).toEqual(["./codeViewerElement.js", "lit"]);
  });

  it("follows a multi-line import to its specifier", () => {
    expect(moduleSpecifiers('import {\n  a,\n  b,\n} from "./many.js";')).toEqual(["./many.js"]);
  });

  it("ignores exported values that are only strings", () => {
    expect(moduleSpecifiers('export const name = "lit";\nexport default "x";')).toEqual([]);
  });
});

describe("isRelativeSpecifier", () => {
  it("treats only ./ and ../ as files the browser can fetch beside this one", () => {
    expect(isRelativeSpecifier("./a.js")).toBe(true);
    expect(isRelativeSpecifier("../a.js")).toBe(true);
    expect(isRelativeSpecifier("lit")).toBe(false);
    expect(isRelativeSpecifier(".hidden")).toBe(false);
  });
});
