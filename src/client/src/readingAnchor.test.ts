import { describe, expect, it } from "vitest";
import { readingAnchorDecision, readingScrollCorrection } from "./readingAnchor";

/**
 * Every combination is answered here, so an unhandled one fails in this file
 * rather than under a reader's eyes.
 */
describe("what the transcript does with the scroll position on an update", () => {
  it("follows the tail for a reader who is following the tail", () => {
    expect(readingAnchorDecision({ prepending: false, pinnedToBottom: true })).toBe("follow-tail");
  });

  it("holds the reading position for a reader who has scrolled up", () => {
    expect(readingAnchorDecision({ prepending: false, pinnedToBottom: false })).toBe("hold-reading-position");
  });

  it("uses the prepend anchor when earlier history arrives while following", () => {
    expect(readingAnchorDecision({ prepending: true, pinnedToBottom: true })).toBe("prepend");
  });

  it("uses the prepend anchor when earlier history arrives while reading", () => {
    expect(readingAnchorDecision({ prepending: true, pinnedToBottom: false })).toBe("prepend");
  });
});

describe("how far the scroller moves to hold a row in place", () => {
  it("takes back exactly what content above the row added", () => {
    expect(readingScrollCorrection(100, 140)).toBe(40);
  });

  it("gives back exactly what content above the row removed", () => {
    expect(readingScrollCorrection(140, 100)).toBe(-40);
  });

  it("does not move when the row did not move", () => {
    expect(readingScrollCorrection(100, 100)).toBe(0);
  });
});
