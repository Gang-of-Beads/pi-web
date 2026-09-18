import { describe, expect, it } from "vitest";
import { backgroundRunCountOf, backgroundRunNote } from "./backgroundRunNote";

describe("backgroundRunNote", () => {
  it("says nothing while the assistant's own turn is running", () => {
    expect(backgroundRunNote(3, false)).toBeUndefined();
  });

  it("says nothing when no background work is running", () => {
    expect(backgroundRunNote(0, true)).toBeUndefined();
    expect(backgroundRunNote(undefined, true)).toBeUndefined();
    expect(backgroundRunNote("2", true)).toBeUndefined();
  });

  it("counts in the reader's words", () => {
    expect(backgroundRunNote(1, true)).toBe("1 background run");
    expect(backgroundRunNote(4, true)).toBe("4 background runs");
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
