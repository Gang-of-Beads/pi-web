import { describe, expect, it } from "vitest";
import { switcherEmptyMeaning, switcherScopeNotice } from "./switcherEmptyMeaning";

const base = { answer: "complete" as const, matchCount: 0, query: "", scoped: false };

/**
 * B48, P1 slice 5: the list claims only what it knows. It never says
 * "Loading sessions…" (owner Q2) or a failure, and it says nothing while any
 * source of the board has not answered - a missing row may be in it.
 */
describe("switcherEmptyMeaning", () => {
  it("names every combination of the board's answer, matches, query and scope", () => {
    const table = {
      "rows on screen": switcherEmptyMeaning({ ...base, matchCount: 3 }),
      "rows on a partial board": switcherEmptyMeaning({ ...base, answer: "partial", matchCount: 3 }),
      "nothing answered": switcherEmptyMeaning({ ...base, answer: "none" }),
      "nothing answered, with a query": switcherEmptyMeaning({ ...base, answer: "none", query: "bill" }),
      "partial, no rows": switcherEmptyMeaning({ ...base, answer: "partial" }),
      "partial, a query that matched nothing": switcherEmptyMeaning({ ...base, answer: "partial", query: "bill" }),
      "complete, a query that matched nothing": switcherEmptyMeaning({ ...base, query: " bill " }),
      "complete, narrowed to nothing": switcherEmptyMeaning({ ...base, scoped: true }),
      "complete and empty": switcherEmptyMeaning(base),
    };
    expect(table).toEqual({
      "rows on screen": { kind: "none" },
      "rows on a partial board": { kind: "none" },
      "nothing answered": { kind: "unknown" },
      "nothing answered, with a query": { kind: "unknown" },
      "partial, no rows": { kind: "unknown" },
      "partial, a query that matched nothing": { kind: "unknown" },
      "complete, a query that matched nothing": { kind: "query", message: "No sessions match “bill”." },
      "complete, narrowed to nothing": { kind: "scope", message: "No sessions in this part of the path.", widen: true },
      "complete and empty": { kind: "empty", message: "No sessions yet." },
    });
  });
});

describe("switcherScopeNotice", () => {
  it("says nothing when no project is chosen", () => {
    expect(switcherScopeNotice({ projectId: undefined, knownFolderCount: 0 })).toBeUndefined();
  });

  it("says nothing once the project's folders are known", () => {
    expect(switcherScopeNotice({ projectId: "p1", knownFolderCount: 2 })).toBeUndefined();
  });

  it("names the provisional listing while a chosen project has no known folders", () => {
    expect(switcherScopeNotice({ projectId: "p1", knownFolderCount: 0 })).toBe("Folders for this project are still loading, so every session is listed.");
  });
});
