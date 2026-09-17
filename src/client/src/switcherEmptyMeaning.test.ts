import { describe, expect, it } from "vitest";
import { switcherEmptyMeaning } from "./switcherEmptyMeaning";

const base = { loadError: undefined, loading: false, matchCount: 0, query: "", scoped: false };

describe("switcherEmptyMeaning", () => {
  it("says nothing while rows are on screen", () => {
    expect(switcherEmptyMeaning({ ...base, matchCount: 3 })).toEqual({ kind: "none" });
  });

  it("reports a failed read rather than an empty list", () => {
    expect(switcherEmptyMeaning({ ...base, loadError: "Machine unreachable" })).toEqual({ kind: "failed", message: "Machine unreachable" });
  });

  it("prefers the failure over the loading state", () => {
    expect(switcherEmptyMeaning({ ...base, loadError: "boom", loading: true }).kind).toBe("failed");
  });

  it("says loading while nothing is known", () => {
    expect(switcherEmptyMeaning({ ...base, loading: true })).toEqual({ kind: "loading", message: "Loading sessions…" });
  });

  it("names the query when a search matched nothing", () => {
    expect(switcherEmptyMeaning({ ...base, query: " bill " })).toEqual({ kind: "query", message: "No sessions match “bill”." });
  });

  it("names the scope and offers to widen when the path narrowed to nothing", () => {
    expect(switcherEmptyMeaning({ ...base, scoped: true })).toEqual({ kind: "scope", message: "No sessions in this part of the path.", widen: true });
  });

  it("claims emptiness only for a loaded, unscoped, unsearched machine", () => {
    expect(switcherEmptyMeaning(base)).toEqual({ kind: "empty", message: "No sessions yet." });
  });
});
