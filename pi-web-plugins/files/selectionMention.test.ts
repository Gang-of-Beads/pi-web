import { describe, expect, it } from "vitest";
import { mentionLineRange, mentionRef } from "./selectionMention.js";

describe("mentionRef", () => {
  it("formats a range the @-completion understands, low-high regardless of drag direction", () => {
    expect(mentionRef("src/a.ts", 12, 20)).toBe("@src/a.ts:12-20");
    expect(mentionRef("src/a.ts", 20, 12)).toBe("@src/a.ts:12-20");
    expect(mentionRef("README.md", 7, 7)).toBe("@README.md:7");
  });
});

describe("mentionLineRange", () => {
  const doc = "one\ntwo\nthree\nfour";

  it("counts lines from offsets and refuses a collapsed selection", () => {
    expect(mentionLineRange(doc, 0, 3)).toEqual({ start: 1, end: 1 });
    expect(mentionLineRange(doc, 0, 9)).toEqual({ start: 1, end: 3 });
    expect(mentionLineRange(doc, 13, 4)).toEqual({ start: 2, end: 3 });
    expect(mentionLineRange(doc, 5, 5)).toBeUndefined();
  });
});
