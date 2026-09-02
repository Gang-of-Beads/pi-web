/** What a finished image should do to the reader's scroll position. */
export type ImageLoadScrollOutcome =
  | { action: "follow-to-bottom" }
  | { action: "leave-alone" }
  | { action: "compensate"; pixels: number };

/**
 * How to answer an image that has just taken up room it was not taking before.
 *
 * Attachments load lazily, so scrolling back through a session decodes them as
 * they come into view. One that completes above the reader lengthens the
 * document above them and carries what they were reading downwards. The
 * scroller sets overflow-anchor: none, so the browser will not hold the place
 * either.
 *
 * Compensation is by the height the document actually gained, because by the
 * time a load is reported the shift has already happened - measuring positions
 * afterwards only re-reads the moved layout and would correct nothing.
 *
 * A reader pinned to the bottom wants to follow the growth instead, and a
 * reader whose gesture is in flight owns the scroll outright: correcting under
 * a moving thumb is the snap-back this file's caller was fixed for. An image
 * below the reader moves nothing they can see.
 */
export function imageLoadScrollCorrection(input: {
  pinnedToBottom: boolean;
  userScrolling: boolean;
  imageEndsAboveViewport: boolean;
  heightGained: number;
}): ImageLoadScrollOutcome {
  if (input.pinnedToBottom) return { action: "follow-to-bottom" };
  if (input.userScrolling) return { action: "leave-alone" };
  if (!input.imageEndsAboveViewport) return { action: "leave-alone" };
  if (input.heightGained <= 0) return { action: "leave-alone" };
  return { action: "compensate", pixels: input.heightGained };
}
