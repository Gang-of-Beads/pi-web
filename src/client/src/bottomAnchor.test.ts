import { describe, expect, it } from "vitest";
import { bottomAnchorAction, type BottomAnchorInput } from "./bottomAnchor.js";

const growing: BottomAnchorInput = {
  pinnedToBottom: true,
  readerHoldsGround: false,
  userScrolling: false,
  previousHeight: 1000,
  currentHeight: 1040,
};

describe("bottomAnchorAction", () => {
  it("holds the bottom when content grew under a reader who is following", () => {
    expect(bottomAnchorAction(growing)).toBe("hold-bottom");
  });

  it("leaves a reader who scrolled away alone", () => {
    expect(bottomAnchorAction({ ...growing, pinnedToBottom: false })).toBe("leave-alone");
  });

  it("leaves the ground still while the reader is touching it", () => {
    expect(bottomAnchorAction({ ...growing, readerHoldsGround: true })).toBe("leave-alone");
  });

  it("leaves the scroll alone during a gesture", () => {
    expect(bottomAnchorAction({ ...growing, userScrolling: true })).toBe("leave-alone");
  });

  it("does nothing when the height is unchanged", () => {
    expect(bottomAnchorAction({ ...growing, currentHeight: 1000 })).toBe("leave-alone");
  });

  it("does nothing when content shrank", () => {
    expect(bottomAnchorAction({ ...growing, currentHeight: 900 })).toBe("leave-alone");
  });

  it("does nothing on the first measurement", () => {
    expect(bottomAnchorAction({ ...growing, previousHeight: undefined })).toBe("leave-alone");
  });
});
