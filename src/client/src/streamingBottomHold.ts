export type StreamingBottomHoldAction = "hold-bottom" | "leave-alone" | "stop-watching";

export interface StreamingBottomHoldInput {
  sessionLive: boolean;
  pinnedToBottom: boolean;
  userScrolling: boolean;
  distanceFromBottom: number;
}

/**
 * What to do with the bottom edge between renders, while an answer streams.
 *
 * Reported repeatedly: with a message queued under a streaming reply, the
 * queued bubble was pushed down and snapped back, over and over. Growth during
 * a turn happens inside already-rendered children - a formatted-text block
 * gaining a line, a tool result filling in - so the transcript's own render,
 * where the bottom is normally re-pinned, never runs for it. The scroller sets
 * overflow-anchor: none, so the browser does not hold the place either, and
 * the bottom drifts until the next parent update yanks it back.
 *
 * The watch is therefore only worth running while a turn is live, and only for
 * a reader who is actually aimed at the bottom; a finger on the screen is
 * never fought, and a reader who scrolled up keeps their position.
 */
export function streamingBottomHold(input: StreamingBottomHoldInput): StreamingBottomHoldAction {
  if (!input.sessionLive) return "stop-watching";
  if (!input.pinnedToBottom) return "stop-watching";
  if (input.userScrolling) return "leave-alone";
  return input.distanceFromBottom > BOTTOM_SLACK_PX ? "hold-bottom" : "leave-alone";
}

/**
 * Sub-pixel layout rounding leaves a fraction of a pixel at the bottom on
 * fractional device scales; correcting that would mean writing scrollTop every
 * frame of every turn for a distance nobody can see.
 */
const BOTTOM_SLACK_PX = 2;
