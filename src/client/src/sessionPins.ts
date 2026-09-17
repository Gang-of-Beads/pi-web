/**
 * Pinned sessions, remembered on this device.
 *
 * A pin is a personal "keep this close" mark, so it lives in local storage
 * rather than on the daemon: it is cheap, needs no round trip, and a pin that
 * did not survive a reload would be worse than no pin at all. It is per-device
 * by design; syncing pins across devices would be a server feature, not this.
 *
 * A pin carries the scope it belongs to: session ids are unique per machine,
 * not across machines, so the set is stored per machine id. The legacy flat
 * array predates multi-machine support and is read once as the local
 * machine's pins, which is where every pin it can contain was made.
 *
 * The functions are pure over an injected storage so the set logic is testable
 * without a browser.
 */

export const SESSION_PINS_STORAGE_KEY = "pi-web.pinnedSessions";

export type PinStorage = Pick<Storage, "getItem" | "setItem">;

/** The machine a legacy flat pin list is attributed to. */
export const LEGACY_PIN_MACHINE_ID = "local";

export function readPinnedSessionIds(machineId: string, storage = browserStorage()): Set<string> {
  if (storage === undefined) return new Set();
  try {
    const raw = storage.getItem(SESSION_PINS_STORAGE_KEY);
    if (raw === null || raw === "") return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return machineId === LEGACY_PIN_MACHINE_ID ? stringSet(parsed) : new Set();
    }
    const scopes = scopeEntries(parsed);
    const scoped = scopes[machineId];
    return scoped === undefined ? new Set() : stringSet(scoped);
  } catch {
    return new Set();
  }
}

export function writePinnedSessionIds(machineId: string, ids: ReadonlySet<string>, storage = browserStorage()): void {
  if (storage === undefined) return;
  try {
    storage.setItem(SESSION_PINS_STORAGE_KEY, JSON.stringify({ ...readAllScopes(storage), [machineId]: [...ids] }));
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

function scopeEntries(parsed: unknown): Record<string, readonly unknown[]> {
  if (typeof parsed !== "object" || parsed === null) return {};
  const scopes: Record<string, readonly unknown[]> = {};
  for (const [key, value] of Object.entries<unknown>({ ...parsed })) {
    if (Array.isArray(value)) scopes[key] = value;
  }
  return scopes;
}

function stringSet(values: readonly unknown[]): Set<string> {
  return new Set(values.filter((value): value is string => typeof value === "string"));
}

function readAllScopes(storage: PinStorage): Record<string, string[]> {
  try {
    const raw = storage.getItem(SESSION_PINS_STORAGE_KEY);
    if (raw === null || raw === "") return {};
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return { [LEGACY_PIN_MACHINE_ID]: [...stringSet(parsed)] };
    const scopes: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(scopeEntries(parsed))) scopes[key] = [...stringSet(value)];
    return scopes;
  } catch {
    return {};
  }
}

function browserStorage(): PinStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
