import { describe, expect, it } from "vitest";
import { mentionRef } from "./selectionMention.js";

describe("mentionRef", () => {
  it("formats a range the @-completion understands, low-high regardless of drag direction", () => {
    expect(mentionRef("src/a.ts", 12, 20)).toBe("@src/a.ts:12-20");
    expect(mentionRef("src/a.ts", 20, 12)).toBe("@src/a.ts:12-20");
    expect(mentionRef("README.md", 7, 7)).toBe("@README.md:7");
  });
});

