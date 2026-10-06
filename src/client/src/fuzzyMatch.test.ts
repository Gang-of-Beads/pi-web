import { describe, expect, it } from "vitest";
import { fuzzyRank, fuzzyScore, isAbbreviation, searchTokens } from "./fuzzyMatch";

describe("searchTokens", () => {
  it("splits on whitespace and lowercases", () => {
    expect(searchTokens("  Opus-5   WORK ")).toEqual(["opus-5", "work"]);
  });

  it("returns nothing for a blank query", () => {
    expect(searchTokens("   ")).toEqual([]);
  });
});

describe("fuzzyScore", () => {
  it("scores a substring hit above an abbreviation hit", () => {
    const substring = fuzzyScore("claude-opus-5", "opus") ?? -1;
    const abbreviation = fuzzyScore("claude-opus-5", "cop5") ?? -1;
    expect(abbreviation).toBeGreaterThan(0);
    expect(substring).toBeGreaterThan(abbreviation);
  });

  it("rewards a match at a word boundary over one mid-token", () => {
    const boundary = fuzzyScore("anthropic-work/claude-opus-5", "claude") ?? -1;
    const middle = fuzzyScore("xxclaudexx", "claude") ?? -1;
    expect(middle).toBeGreaterThan(0);
    expect(boundary).toBeGreaterThan(middle);
  });

  it("returns undefined when a token cannot match", () => {
    expect(fuzzyScore("claude-opus-5", "gemini")).toBeUndefined();
  });

  it("scores an unfiltered query as neutral rather than rejecting it", () => {
    expect(fuzzyScore("anything", "")).toBe(0);
  });
});

describe("fuzzyRank", () => {
  const models = [
    "anthropic/claude-opus-4-5",
    "anthropic-personal/claude-opus-5",
    "anthropic-work/claude-opus-5",
    "anthropic-work/claude-haiku-4-5",
    "github-copilot/gpt-5.4",
  ];

  it("puts the intended model first for a two-fragment query", () => {
    expect(fuzzyRank(models, "opus-5 work", (model) => model)[0]).toBe("anthropic-work/claude-opus-5");
  });

  it("keeps only the models that satisfy every fragment", () => {
    expect(fuzzyRank(models, "opus-5 work", (model) => model)).toEqual(["anthropic-work/claude-opus-5"]);
  });

  it("finds every account's copy of a model when only the model is named", () => {
    const ranked = fuzzyRank(models, "opus-5", (model) => model);
    expect(ranked).toContain("anthropic-work/claude-opus-5");
    expect(ranked).toContain("anthropic-personal/claude-opus-5");
  });

  it("returns the list unchanged for a blank query", () => {
    expect(fuzzyRank(models, "  ", (model) => model)).toEqual(models);
  });

  it("preserves input order between equally scored items", () => {
    const ranked = fuzzyRank(["a-match", "b-match"], "match", (value) => value);
    expect(ranked).toEqual(["a-match", "b-match"]);
  });

  it("excludes non-matching items entirely", () => {
    expect(fuzzyRank(models, "gemini", (model) => model)).toEqual([]);
  });
});

describe("isAbbreviation", () => {
  it("accepts word initials", () => {
    expect(isAbbreviation("abc", "a-b-c")).toBe(true);
  });

  it("accepts a run continuing inside a word", () => {
    expect(isAbbreviation("opus5", "claude-opus-5")).toBe(true);
    expect(isAbbreviation("cop5", "claude-opus-5")).toBe(true);
  });

  it("rejects reordering", () => {
    expect(isAbbreviation("cba", "a-b-c")).toBe(false);
  });

  it("rejects characters that neither start a word nor continue the match", () => {
    expect(isAbbreviation("nt", "anthropic")).toBe(false);
  });

  it("backtracks past a dead-end candidate", () => {
    // The first "c" of "cc" must match the second word, not the first, for the
    // trailing "5" to be reachable.
    expect(isAbbreviation("c5", "claude cat-5")).toBe(true);
  });

  it("matches an empty needle", () => {
    expect(isAbbreviation("", "anything")).toBe(true);
  });
});
