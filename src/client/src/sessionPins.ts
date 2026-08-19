/**
 * Pinned sessions, remembered on this device.
 *
 * A pin is a personal "keep this close" mark, so it lives in local storage
 * rather than on the daemon: it is cheap, needs no round trip, and a pin that
 * did not survive a reload would be worse than no pin at all. It is per-device
 * by design; syncing pins across devices would be a server feature, not this.
 *
 * The functions are pure over an injected storage so the set logic is testable
 * without a browser.
 */

export const SESSION_PINS_STORAGE_KEY = "pi-web.pinnedSessions";

export type PinStorage = Pick<Storage, "getItem" | "setItem">;

export function readPinnedSessionIds(storage = browserStorage()): Set<string> {
  if (storage === undefined) return new Set();
  try {
    const raw = storage.getItem(SESSION_PINS_STORAGE_KEY);
    if (raw === null || raw === "") return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set();
  }
}

export function writePinnedSessionIds(ids: ReadonlySet<string>, storage = browserStorage()): void {
  if (storage === undefined) return;
  try {
    storage.setItem(SESSION_PINS_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // A full or unavailable store just means pins do not persist; the in-memory
    // set still works for the session.
  }
}

/** Return a new set with the id toggled, so callers can persist and re-render. */
export function togglePinnedSessionId(ids: ReadonlySet<string>, sessionId: string): Set<string> {
  const next = new Set(ids);
  if (next.has(sessionId)) next.delete(sessionId);
  else next.add(sessionId);
  return next;
}

function browserStorage(): PinStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
