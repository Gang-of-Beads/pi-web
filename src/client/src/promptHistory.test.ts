// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadPromptHistory,
  promptHistoryKey,
  rememberPromptHistory,
  savePromptHistory,
  searchPromptHistory,
} from "./promptHistory";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

const SESSION = "local:session-1";

describe("prompt history storage", () => {
  it("keys history per session so one conversation cannot recall another's prompts", () => {
    rememberPromptHistory(SESSION, "first prompt");
    rememberPromptHistory("local:session-2", "other prompt");

    expect(loadPromptHistory(SESSION)).toEqual(["first prompt"]);
    expect(loadPromptHistory("local:session-2")).toEqual(["other prompt"]);
    expect(promptHistoryKey(SESSION)).toContain(SESSION);
  });

  it("stores newest first", () => {
    rememberPromptHistory(SESSION, "oldest");
    rememberPromptHistory(SESSION, "newest");

    expect(loadPromptHistory(SESSION)).toEqual(["newest", "oldest"]);
  });

  it("promotes a repeated prompt instead of duplicating it", () => {
    rememberPromptHistory(SESSION, "run the tests");
    rememberPromptHistory(SESSION, "something else");
    rememberPromptHistory(SESSION, "run the tests");

    // Re-sending a prompt is common; duplicates would push useful history out.
    expect(loadPromptHistory(SESSION)).toEqual(["run the tests", "something else"]);
  });

  it("trims surrounding whitespace and ignores an empty prompt", () => {
    rememberPromptHistory(SESSION, "  padded  ");
    rememberPromptHistory(SESSION, "   ");

    expect(loadPromptHistory(SESSION)).toEqual(["padded"]);
  });

  it("bounds the history so storage cannot grow without limit", () => {
    for (let index = 0; index < 60; index += 1) rememberPromptHistory(SESSION, `prompt ${String(index)}`);

    const history = loadPromptHistory(SESSION);
    expect(history).toHaveLength(50);
    expect(history[0]).toBe("prompt 59");
  });

  it("returns nothing for a session with no history", () => {
    expect(loadPromptHistory("local:unknown")).toEqual([]);
  });

  it("survives corrupted storage rather than breaking the editor", () => {
    localStorage.setItem(promptHistoryKey(SESSION), "{not json");
    expect(loadPromptHistory(SESSION)).toEqual([]);

    localStorage.setItem(promptHistoryKey(SESSION), JSON.stringify(["ok", 42, "", null]));
    expect(loadPromptHistory(SESSION)).toEqual(["ok"]);
  });

  it("does not throw when storage refuses a write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota exceeded"); });

    // History is a local convenience; losing it must never fail a send.
    expect(() => { savePromptHistory(SESSION, ["value"]); }).not.toThrow();
  });
});

describe("searchPromptHistory", () => {
  it("returns the whole history for an empty query", () => {
    rememberPromptHistory(SESSION, "alpha");
    rememberPromptHistory(SESSION, "beta");

    expect(searchPromptHistory(SESSION, "  ")).toEqual(["beta", "alpha"]);
  });

  it("matches every token independently of order", () => {
    rememberPromptHistory(SESSION, "run the mobile tests");

    expect(searchPromptHistory(SESSION, "tests mobile")).toEqual(["run the mobile tests"]);
  });

  it("matches a subsequence so an abbreviation still finds the prompt", () => {
    rememberPromptHistory(SESSION, "refresh the workspace goals");

    expect(searchPromptHistory(SESSION, "rwg")).toEqual(["refresh the workspace goals"]);
  });

  it("is case insensitive", () => {
    rememberPromptHistory(SESSION, "Deploy The Container");

    expect(searchPromptHistory(SESSION, "deploy container")).toEqual(["Deploy The Container"]);
  });

  it("returns nothing when no entry matches", () => {
    rememberPromptHistory(SESSION, "alpha");

    expect(searchPromptHistory(SESSION, "zzzz")).toEqual([]);
  });

  it("preserves newest-first order among matches", () => {
    rememberPromptHistory(SESSION, "test one");
    rememberPromptHistory(SESSION, "test two");

    expect(searchPromptHistory(SESSION, "test")).toEqual(["test two", "test one"]);
  });
});
