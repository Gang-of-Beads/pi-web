const DEFAULT_TOP_THRESHOLD = 600;
/**
 * How many screens of earlier messages are kept loaded above the reader. One viewport was enough
 * to avoid an empty scroll only when the read was instant, and a screen and a half was not enough
 * on a weak link: scrolling up a 1018-message session on a phone (1.6 Mbps, 150 ms), each ordinary
 * page (213-322 KB) still left the reader waiting at the top about 1.3 s (r158). Three screens
 * start the read while there is still that much to read; the viewport policy asks for the next
 * page as soon as one lands within this distance, so the reader stays one page ahead.
 */
const EARLIER_PREFETCH_SCREENS = 3;
/** The newer end's distance stays a screen and a half: it was not measured short. */
const NEWER_PREFETCH_SCREENS = 1.5;
const VIEWPORT_FILL_TOLERANCE = 1;

export function isNearTop(state: { scrollTop: number; clientHeight: number }): boolean {
  return state.scrollTop < Math.max(DEFAULT_TOP_THRESHOLD, state.clientHeight * EARLIER_PREFETCH_SCREENS);
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
  return distanceToBottom < Math.max(DEFAULT_TOP_THRESHOLD, state.clientHeight * NEWER_PREFETCH_SCREENS);
}

export function doesNotFillViewport(state: { scrollHeight: number; clientHeight: number }): boolean {
  return state.scrollHeight <= state.clientHeight + VIEWPORT_FILL_TOLERANCE;
}
