import { describe, expect, it } from "vitest";
import { backgroundRunCountOf, backgroundRunNote } from "./backgroundRunNote";

describe("backgroundRunNote", () => {
  it("speaks while the assistant's own turn is running too, so the dock carries one merged state", () => {
    expect(backgroundRunNote(3)).toBe("3 background runs");
  });

  it("says nothing when no background work is running", () => {
    expect(backgroundRunNote(0)).toBeUndefined();
    expect(backgroundRunNote(undefined)).toBeUndefined();
    expect(backgroundRunNote("2")).toBeUndefined();
  });

  it("counts in the reader's words", () => {
    expect(backgroundRunNote(1)).toBe("1 background run");
    expect(backgroundRunNote(4)).toBe("4 background runs");
  });
});

describe("backgroundRunCountOf", () => {
  it("reads the count out of a status frame", () => {
    expect(backgroundRunCountOf({ backgroundRunCount: 2 })).toBe(2);
  });

  it("answers undefined for anything that is not a frame", () => {
    expect(backgroundRunCountOf(undefined)).toBeUndefined();
    expect(backgroundRunCountOf(null)).toBeUndefined();
    expect(backgroundRunCountOf({})).toBeUndefined();
  });
});
