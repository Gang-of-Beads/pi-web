/**
 * Whether the transcript must hold the reader's place across an update.
 *
 * Two states, and only two. A reader following the newest message wants the
 * view to move: the tail is the point. A reader who has scrolled up is reading
 * something, and anything that grows above them - a streaming reply, an
 * activity row, a queued message - would slide it out from under their eyes.
 *
 * This matters most while a question waits. The card is the last row, so it is
 * always what scrolling to the bottom reaches; a reader who scrolls up to check
 * something before answering must be able to read it without the page moving.
 *
 * Loading earlier history is its own case: everything shifts by a whole page,
 * and the prepend anchor already handles it. It wins so the two do not both
 * adjust the same scroll.
 */
export type ReadingAnchorDecision = "prepend" | "hold-reading-position" | "follow-tail";

export interface ReadingAnchorInput {
  /** True when this update prepends earlier history. */
  prepending: boolean;
  /** True while the reader is following the newest message. */
  pinnedToBottom: boolean;
}

export function readingAnchorDecision(input: ReadingAnchorInput): ReadingAnchorDecision {
  if (input.prepending) return "prepend";
  return input.pinnedToBottom ? "follow-tail" : "hold-reading-position";
}

/**
 * How far the scroller must move so an anchored row keeps its place.
 *
 * Positive when content above the row grew: the scroller takes those pixels
 * back so the row stays where the reader is looking.
 */
export function readingScrollCorrection(capturedOffset: number, currentOffset: number): number {
  return currentOffset - capturedOffset;
}
