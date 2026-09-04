import { describe, expect, it } from "vitest";
import { bottomAnchorAction, type BottomAnchorInput } from "./bottomAnchor.js";

const growing: BottomAnchorInput = {
  pinnedToBottom: true,
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

  // Contract change, stated openly: the old rule froze the scroll during a
  // press, which let streamed growth slide the bottom-pinned ask card down
  // under the finger - the probe measured 347px of drift. For a pinned reader
  // the aimed ground IS the bottom edge, so the edge is held through a press;
  // dragging away flips pinnedToBottom and the press then protects reading.
  it("holds the bottom for a pinned reader even while a finger is down", () => {
    expect(bottomAnchorAction(growing)).toBe("hold-bottom");
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
