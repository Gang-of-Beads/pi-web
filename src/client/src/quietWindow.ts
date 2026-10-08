import { browserLocalStorage } from "./browserLocalStorage";
import { QUIET_WINDOW_MS } from "./sync/readPhase";

/**
 * The quiet window T of this browser (owner, 2026-09-30, B7; state-diagram D5): how long the
 * session socket may stay silent before the page asks the daemon for anything it missed. It is a
 * setting per device, kept with the browser's other preferences, because a phone and a desktop may
 * want different values. The page names it when it opens the session socket, and the daemon sends
 * a quiet socket a heartbeat every 0.6 T, so a healthy idle socket never reaches it.
 *
 * The page looks every 5 s (PiWebApp's liveness tick) and drops a socket silent for 42 s
 * (LIVENESS_TIMEOUT_MS), so T runs from 5 s, the tick, to 30 s: a look must land between T and
 * the drop, or the drop's reconnect asks before T ever does (review ff7ba655).
 */
const QUIET_WINDOW_STORAGE_KEY = "pi-web.quietWindowSeconds";
export const DEFAULT_QUIET_WINDOW_SECONDS = QUIET_WINDOW_MS / 1000;
export const QUIET_WINDOW_RANGE = { min: 5, max: 30 } as const;

type QuietWindowStorage = Pick<Storage, "getItem" | "setItem">;

/** A stored or typed value in whole seconds within the range; anything else is not a quiet window. */
export function parseQuietWindowSeconds(value: string | null): number | undefined {
  const text = value?.trim() ?? "";
  if (!/^\d{1,3}$/.test(text)) return undefined;
  const seconds = Number(text);
  return seconds >= QUIET_WINDOW_RANGE.min && seconds <= QUIET_WINDOW_RANGE.max ? seconds : undefined;
}

export function readQuietWindowSeconds(storage: QuietWindowStorage | undefined = browserLocalStorage()): number {
  if (storage === undefined) return DEFAULT_QUIET_WINDOW_SECONDS;
  try {
    return parseQuietWindowSeconds(storage.getItem(QUIET_WINDOW_STORAGE_KEY)) ?? DEFAULT_QUIET_WINDOW_SECONDS;
  } catch {
    return DEFAULT_QUIET_WINDOW_SECONDS;
  }
}

/** Keeps the value in this browser; when the browser refuses the write, the previously stored value (or the default when none was stored) stays in use. */
export function writeQuietWindowSeconds(seconds: number, storage: QuietWindowStorage | undefined = browserLocalStorage()): void {
  if (storage === undefined) return;
  try {
    storage.setItem(QUIET_WINDOW_STORAGE_KEY, String(seconds));
  } catch {
    return;
  }
}

