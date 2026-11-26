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

/**
 * The frame the Navigate layer pushes says what it is, so a Back that lands on it shows the list
 * again: the list is the page a session was picked from (owner, 2026-11-26).
 */
const NAVIGATE_FRAME = "navigate";

/** The history state of a layer's own frame. */
export function layerFrameState(layer: "navigate" | "other"): { piWebLayer?: string } {
  return layer === "navigate" ? { piWebLayer: NAVIGATE_FRAME } : {};
}

export function isNavigateFrame(state: unknown): boolean {
  return typeof state === "object" && state !== null && "piWebLayer" in state && state.piWebLayer === NAVIGATE_FRAME;
}

/** The layer's frame stays under what was picked in it: the next route write adds an entry instead of taking its place. */
export function keepPlaceholderFrame(): void { placeholderOutstanding = false; }

/** The back gesture consumed the frame, so there is nothing left to take. */
export function clearPlaceholderFrame(): void { placeholderOutstanding = false; }

/**
 * Whether a modal layer's placeholder frame is still on the history stack.
 * A layer closed by its own cancel leaves the frame behind on purpose, so a
 * caller about to `history.back()` must not assume the next frame is its own.
 */
export function placeholderFrameOutstanding(): boolean { return placeholderOutstanding; }

/** Write the URL, keeping the pieces of one action to a single entry. */
export function writeRouteUrl(url: string, replace: boolean, now: number = Date.now(), forcePush = false): void {
  const mode = replace ? "replace" : forcePush && !placeholderOutstanding ? "push" : historyWriteMode({ lastWriteAt, now, placeholderOutstanding });
  lastWriteAt = now;
  placeholderOutstanding = false;
  if (mode === "replace") window.history.replaceState({}, "", url);
  else window.history.pushState({}, "", url);
}
