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
  if (input.pinnedToBottom) return "follow-tail";
  if (input.prepending) return "prepend";
  return "hold-reading-position";
}

/**
 * Whether this update is worth measuring the reader's place for.
 *
 * The hold used to run on every render: it walked every message row, measured
 * until it found a visible one, then wrote `scrollTop`. On a long transcript
 * that walk and its forced layout ran several times a second while a reply
 * streamed, which made scrolling crawl, and writing `scrollTop` under a live
 * gesture snapped the view back out of the reader's hands.
 *
 * Neither cost buys anything unless content *above* the reader can have moved.
 * A reply streaming below the fold moves nothing above them, and a reader whose
 * finger is on the screen owns the scroll position outright - except when rows
 * above them leave the window: a page read forward trims the window's top, and
 * left alone the rows under a dragging finger jumped by the trimmed height
 * (24,195 px measured at 393x850, 2026-10-29). The trim is the window's doing,
 * not the reader's, so it is held through the gesture, as a prepend is.
 */
export function shouldHoldReadingPosition(input: { pinnedToBottom: boolean; contentAboveChanged: boolean; userScrolling: boolean; rowsLeftAbove?: boolean }): boolean {
  if (input.pinnedToBottom) return false;
  if (input.rowsLeftAbove === true) return true;
  if (input.userScrolling) return false;
  return input.contentAboveChanged;
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
