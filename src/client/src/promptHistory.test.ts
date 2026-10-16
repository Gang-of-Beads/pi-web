// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { historyIndexStep, loadPromptHistory, type PromptHistoryEntry,
  promptHistoryKey,
  rememberPromptHistory,
  savePromptHistory,
  searchPromptHistory, } from "./promptHistory";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

const SESSION = "local:session-1";

function texts(entries: readonly PromptHistoryEntry[]): string[] {
  return entries.map((entry) => entry.text);
}

describe("prompt history storage", () => {
  it("keys history per session so one conversation cannot recall another's prompts", () => {
    rememberPromptHistory(SESSION, "first prompt");
    rememberPromptHistory("local:session-2", "other prompt");

    expect(texts(loadPromptHistory(SESSION))).toEqual(["first prompt"]);
    expect(texts(loadPromptHistory("local:session-2"))).toEqual(["other prompt"]);
    expect(promptHistoryKey(SESSION)).toContain(SESSION);
  });

  it("stores newest first", () => {
    rememberPromptHistory(SESSION, "oldest");
    rememberPromptHistory(SESSION, "newest");

    expect(texts(loadPromptHistory(SESSION))).toEqual(["newest", "oldest"]);
  });

  it("promotes a repeated prompt instead of duplicating it", () => {
    rememberPromptHistory(SESSION, "run the tests");
    rememberPromptHistory(SESSION, "something else");
    rememberPromptHistory(SESSION, "run the tests");

    // Re-sending a prompt is common; duplicates would push useful history out.
    expect(texts(loadPromptHistory(SESSION))).toEqual(["run the tests", "something else"]);
  });

  it("trims surrounding whitespace and ignores an empty prompt", () => {
    rememberPromptHistory(SESSION, "  padded  ");
    rememberPromptHistory(SESSION, "   ");

    expect(texts(loadPromptHistory(SESSION))).toEqual(["padded"]);
  });

  it("bounds the history so storage cannot grow without limit", () => {
    for (let index = 0; index < 60; index += 1) rememberPromptHistory(SESSION, `prompt ${String(index)}`);

    const history = texts(loadPromptHistory(SESSION));
    expect(history).toHaveLength(50);
    expect(history[0]).toBe("prompt 59");
  });

  it("returns nothing for a session with no history", () => {
    expect(texts(loadPromptHistory("local:unknown"))).toEqual([]);
  });

  it("survives corrupted storage rather than breaking the editor", () => {
    localStorage.setItem(promptHistoryKey(SESSION), "{not json");
    expect(texts(loadPromptHistory(SESSION))).toEqual([]);

    localStorage.setItem(promptHistoryKey(SESSION), JSON.stringify(["ok", 42, "", null]));
    expect(texts(loadPromptHistory(SESSION))).toEqual(["ok"]);
  });

  it("does not throw when storage refuses a write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota exceeded"); });

    // History is a local convenience; losing it must never fail a send.
    expect(() => { savePromptHistory(SESSION, [{ text: "value" }]); }).not.toThrow();
  });
});

describe("searchPromptHistory", () => {
  it("returns the whole history for an empty query", () => {
    rememberPromptHistory(SESSION, "alpha");
    rememberPromptHistory(SESSION, "beta");

    expect(texts(searchPromptHistory(SESSION, "  "))).toEqual(["beta", "alpha"]);
  });

  it("matches every token independently of order", () => {
    rememberPromptHistory(SESSION, "run the mobile tests");

    expect(texts(searchPromptHistory(SESSION, "tests mobile"))).toEqual(["run the mobile tests"]);
  });

  it("matches a subsequence so an abbreviation still finds the prompt", () => {
    rememberPromptHistory(SESSION, "refresh the workspace goals");

    expect(texts(searchPromptHistory(SESSION, "rwg"))).toEqual(["refresh the workspace goals"]);
  });

  it("is case insensitive", () => {
    rememberPromptHistory(SESSION, "Deploy The Container");

    expect(texts(searchPromptHistory(SESSION, "deploy container"))).toEqual(["Deploy The Container"]);
  });

  it("returns nothing when no entry matches", () => {
    rememberPromptHistory(SESSION, "alpha");

    expect(texts(searchPromptHistory(SESSION, "zzzz"))).toEqual([]);
  });

  it("preserves newest-first order among matches", () => {
    rememberPromptHistory(SESSION, "test one");
    rememberPromptHistory(SESSION, "test two");

    expect(texts(searchPromptHistory(SESSION, "test"))).toEqual(["test two", "test one"]);
  });
});

describe("history direction", () => {
  // Up went to the most recent entry and then stopped, because it stepped
  // toward index -1; Down walked further back. That is inverted from every
  // shell and from pi's terminal UI, where Up means "further back".
  it("counts up for older, since index 0 is the most recent entry", () => {
    expect(historyIndexStep("older")).toBe(1);
    expect(historyIndexStep("newer")).toBe(-1);
  });
});

describe("history beyond one browser", () => {
  /**
   * The entrance opened only onto what this browser had typed: on a fresh
   * device a session with fifteen thousand messages offered nothing. The
   * session's own user messages are the same history, arrived by another
   * door.
   */
  it("searches session prompts alongside the local ones, without repeating either", () => {
    localStorage.setItem(promptHistoryKey("k"), JSON.stringify(["typed here earlier"]));

    const found = texts(searchPromptHistory("k", "", [{ text: "shipped from the server" }, { text: "typed here earlier" }]));

    expect(found).toEqual(["typed here earlier", "shipped from the server"]);
  });

  it("filters session prompts by the same token rules", () => {
    const found = texts(searchPromptHistory("empty", "server shped", [{ text: "shipped from the server" }, { text: "unrelated" }]));

    expect(found).toEqual(["shipped from the server"]);
  });
});
