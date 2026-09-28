import { describe, expect, it } from "vitest";
import { joinTakenBack } from "./composerTakeBack";

describe("joinTakenBack", () => {
  it("gives an empty composer the returned message as it was", () => {
    expect(joinTakenBack("", "the failed prompt")).toBe("the failed prompt");
    expect(joinTakenBack("  \n", "the failed prompt")).toBe("the failed prompt");
  });

  it("keeps a half-typed draft first and puts the returned message after it", () => {
    expect(joinTakenBack("my new draft\n", "the failed prompt")).toBe("my new draft\n\nthe failed prompt");
  });

  it("leaves the draft alone when nothing came back", () => {
    expect(joinTakenBack("my new draft", "   ")).toBe("my new draft");
  });
});
