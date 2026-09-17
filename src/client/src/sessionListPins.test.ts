import { describe, expect, it } from "vitest";
import { splitPinnedSessionRows } from "./sessionListPins";

const row = (id: string, depth = 0) => ({ session: { id }, depth });

describe("splitPinnedSessionRows", () => {
  it("lifts pinned roots into their own group and leaves the rest in order", () => {
    const rows = [row("a"), row("b"), row("c")];
    const split = splitPinnedSessionRows(rows, new Set(["b"]), { searching: false });
    expect(split.pinned.map((entry) => entry.session.id)).toEqual(["b"]);
    expect(split.rest.map((entry) => entry.session.id)).toEqual(["a", "c"]);
  });

  it("keeps a pinned child in its subtree", () => {
    const rows = [row("parent"), row("child", 1)];
    const split = splitPinnedSessionRows(rows, new Set(["child"]), { searching: false });
    expect(split.pinned).toEqual([]);
    expect(split.rest.map((entry) => entry.session.id)).toEqual(["parent", "child"]);
  });

  it("does not reorder while a search is running", () => {
    const rows = [row("a"), row("b")];
    const split = splitPinnedSessionRows(rows, new Set(["b"]), { searching: true });
    expect(split.pinned).toEqual([]);
    expect(split.rest.map((entry) => entry.session.id)).toEqual(["a", "b"]);
  });

  it("leaves a pinned root in place while its descendants are on screen", () => {
    const rows = [row("root"), row("child", 1), row("other")];
    const split = splitPinnedSessionRows(rows, new Set(["root"]), { searching: false });
    expect(split.pinned).toEqual([]);
    expect(split.rest.map((entry) => entry.session.id)).toEqual(["root", "child", "other"]);
  });

  it("ignores pinned ids that are not in the list", () => {
    const rows = [row("a")];
    const split = splitPinnedSessionRows(rows, new Set(["gone"]), { searching: false });
    expect(split.pinned).toEqual([]);
    expect(split.rest.map((entry) => entry.session.id)).toEqual(["a"]);
  });

  it("returns empty groups for an empty list", () => {
    expect(splitPinnedSessionRows([], new Set(["a"]), { searching: false })).toEqual({ pinned: [], rest: [] });
  });

  it("is a no-op when nothing is pinned", () => {
    const rows = [row("a")];
    expect(splitPinnedSessionRows(rows, new Set(), { searching: false })).toEqual({ pinned: [], rest: rows });
  });
});
