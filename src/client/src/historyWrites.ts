export const HISTORY_COALESCE_MS = 400;

/**
 * One action writes the route in several pieces: the tool, the view, and the
 * tool's own arguments each update the URL. Pushing every piece left one tap
 * worth of history behind as six entries.
 */
export function historyWriteMode(state: {
  lastWriteAt: number | undefined;
  now: number;
  placeholderOutstanding?: boolean;
}): "push" | "replace" {
  if (state.placeholderOutstanding === true) return "replace";
  if (state.lastWriteAt === undefined) return "push";
  return state.now - state.lastWriteAt < HISTORY_COALESCE_MS ? "replace" : "push";
}

let lastWriteAt: number | undefined;
let placeholderOutstanding = false;

/** A sheet pushed a frame of its own; the next route write takes its place. */
export function notePlaceholderFrame(): void { placeholderOutstanding = true; }

/** The back gesture consumed the frame, so there is nothing left to take. */
export function clearPlaceholderFrame(): void { placeholderOutstanding = false; }

/** Write the URL, keeping the pieces of one action to a single entry. */
export function writeRouteUrl(url: string, replace: boolean, now: number = Date.now()): void {
  const mode = replace ? "replace" : historyWriteMode({ lastWriteAt, now, placeholderOutstanding });
  lastWriteAt = now;
  placeholderOutstanding = false;
  if (mode === "replace") window.history.replaceState({}, "", url);
  else window.history.pushState({}, "", url);
}
