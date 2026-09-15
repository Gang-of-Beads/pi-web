import { describe, expect, it } from "vitest";
import { codeFenceLanguage, codeFenceVerdict } from "./codeFence";

describe("codeFenceLanguage", () => {
  it("reads the info-string language marked keeps on the code element, case-folded", () => {
    expect(codeFenceLanguage("language-Mermaid")).toBe("mermaid");
    expect(codeFenceLanguage("hljs language-c++ other")).toBe("c++");
    expect(codeFenceLanguage("")).toBeUndefined();
    expect(codeFenceLanguage("code-block")).toBeUndefined();
  });
});

describe("codeFenceVerdict", () => {
  const claims = (language: string): boolean => language === "mermaid";

  it("enumerates every verdict", () => {
    expect(codeFenceVerdict("", claims)).toEqual({ kind: "plain", reason: "no-language" });
    expect(codeFenceVerdict("language-ts", claims)).toEqual({ kind: "plain", reason: "unclaimed" });
    expect(codeFenceVerdict("language-mermaid", claims)).toEqual({ kind: "claimed", language: "mermaid" });
    expect(codeFenceVerdict("language-MERMAID", claims)).toEqual({ kind: "claimed", language: "mermaid" });
  });
});
