const DEFAULT_TOP_THRESHOLD = 600;
/**
 * How much of a screen is kept loaded ahead of the reader. One viewport was
 * enough to avoid an empty scroll only when the read was instant; a screen and
 * a half starts the fetch while there is still something to read.
 */
const PREFETCH_SCREENS = 1.5;
const VIEWPORT_FILL_TOLERANCE = 1;

export function isNearTop(state: { scrollTop: number; clientHeight: number }): boolean {
  return state.scrollTop < Math.max(DEFAULT_TOP_THRESHOLD, state.clientHeight * PREFETCH_SCREENS);
}

export interface ChatNewerLoadState {
  hasNewer: boolean;
  loadingNewer: boolean;
  canRequest: boolean;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * The same rule at the other end. Reading forward out of an anchored position
 * used to stop at a button; the reader asked for the list to load itself, so
 * approaching the last screen fetches the next one.
 */
export function shouldRequestNewerMessages(state: ChatNewerLoadState): boolean {
  if (!state.hasNewer || state.loadingNewer || !state.canRequest || state.clientHeight <= 0) return false;
  const distanceToBottom = state.scrollHeight - state.scrollTop - state.clientHeight;
  return distanceToBottom < Math.max(DEFAULT_TOP_THRESHOLD, state.clientHeight * PREFETCH_SCREENS);
}

export function doesNotFillViewport(state: { scrollHeight: number; clientHeight: number }): boolean {
  return state.scrollHeight <= state.clientHeight + VIEWPORT_FILL_TOLERANCE;
}
