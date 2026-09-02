import { describe, expect, it } from "vitest";
import { shouldHoldReadingPosition, readingScrollCorrection } from "./readingAnchor.js";

/**
 * Holding a reader's place must not cost a measurement on every frame.
 *
 * The hold was applied on every render: it queried every `article.msg` in the
 * transcript, measured each one until it found a visible row, then wrote
 * `scrollTop`. On a session with thousands of messages that walk and its forced
 * layout run several times a second while a reply streams, which made the
 * transcript crawl - and because it writes `scrollTop` while the reader's own
 * gesture is moving it, the view snapped back under their thumb. The owner
 * reported both: it never reaches the bottom, and it keeps flashing back.
 *
 * The measure-and-restore is only meaningful when content above the reader can
 * have changed. A reply streaming below the fold moves nothing above them, and
 * a reader who is actively scrolling owns the scroll position outright.
 */

describe("when a reading position is worth holding", () => {
  it("holds when rows were added above the reader", () => {
    expect(shouldHoldReadingPosition({ pinnedToBottom: false, contentAboveChanged: true, userScrolling: false })).toBe(true);
  });

  /** The streaming case: everything new is below, so nothing needs restoring. */
  it("does not hold when only content below the reader changed", () => {
    expect(shouldHoldReadingPosition({ pinnedToBottom: false, contentAboveChanged: false, userScrolling: false })).toBe(false);
  });

  /** The flash-back case: the reader's own gesture owns the scroll. */
  it("never fights a scroll gesture in progress", () => {
    expect(shouldHoldReadingPosition({ pinnedToBottom: false, contentAboveChanged: true, userScrolling: true })).toBe(false);
  });

  it("does not hold a reader who is following the tail", () => {
    expect(shouldHoldReadingPosition({ pinnedToBottom: true, contentAboveChanged: true, userScrolling: false })).toBe(false);
  });

  it("leaves the scroll alone when the anchor did not move", () => {
    expect(readingScrollCorrection(120, 120)).toBe(0);
  });

  it("takes back exactly what grew above the anchor", () => {
    expect(readingScrollCorrection(120, 180)).toBe(60);
  });
});
