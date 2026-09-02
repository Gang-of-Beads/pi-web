import { describe, expect, it } from "vitest";
import { imageLoadScrollCorrection } from "./imageLoadScroll.js";

/**
 * Scrolling back through a session full of screenshots used to walk away from
 * the reader: attachments load lazily, each one completing above the reader
 * lengthened the document above them, and nothing put the place back. The
 * scroller disables the browser's own anchoring, and the render-time gate that
 * holds the reading position never sees an image load, because a load is a
 * browser event and not a render.
 */

const base = { pinnedToBottom: false, userScrolling: false, imageEndsAboveViewport: true, heightGained: 120 };

describe("an image that finished loading", () => {
  it("gives back exactly the height the document gained above the reader", () => {
    expect(imageLoadScrollCorrection(base)).toEqual({ action: "compensate", pixels: 120 });
  });

  it("follows the growth down for a reader pinned to the bottom", () => {
    expect(imageLoadScrollCorrection({ ...base, pinnedToBottom: true })).toEqual({ action: "follow-to-bottom" });
  });

  /** Correcting under a moving thumb is the snap-back this gate exists for. */
  it("leaves the scroll alone while a gesture is in flight", () => {
    expect(imageLoadScrollCorrection({ ...base, userScrolling: true })).toEqual({ action: "leave-alone" });
  });

  it("ignores an image below the reader, which moves nothing they can see", () => {
    expect(imageLoadScrollCorrection({ ...base, imageEndsAboveViewport: false })).toEqual({ action: "leave-alone" });
  });

  /** A cached image that reserved its space already gained nothing. */
  it("does nothing when the document did not grow", () => {
    expect(imageLoadScrollCorrection({ ...base, heightGained: 0 })).toEqual({ action: "leave-alone" });
  });
});
