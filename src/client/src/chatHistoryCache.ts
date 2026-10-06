const CACHE_PREFIX = "pi-web:chat-history:v2:";
/**
 * How long a cached page may be used before it is re-read from scratch.
 *
 * Staleness is cheap here and absence is not: a hit draws the session at once
 * while the join read confirms it (docs/design/sync-convergence.md, phase B),
 * and a miss draws nothing until the whole tail has arrived. Half an hour meant
 * a session revisited after lunch always opened blank.
 */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * What one session may take of the shared quota.
 *
 * sessionStorage is a single ~5MB budget for the whole origin, and this cache
 * used to swallow the quota failure with no eviction: a transcript big enough
 * to exceed what was left was simply never cached, and those are exactly the
 * transcripts where reopening a session is slow. A per-entry ceiling keeps one
 * enormous session from claiming the budget, and eviction makes room instead of
 * giving up.
 */
const MAX_ENTRY_BYTES = 512 * 1024;

/**
 * The storage this cache writes to.
 *
 * Injected rather than reached for, so eviction can be tested against a store
 * with a real capacity instead of against whatever the test environment's
 * Storage stub happens to implement.
 */
export interface HistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): string[];
}

/**
 * Where the pages live.
 *
 * sessionStorage empties when the tab closes, which on a phone is every time
 * the browser reclaims the app: reopening a conversation then rebuilt its
 * whole transcript from the daemon, which is exactly the cost this cache
 * exists to avoid. localStorage survives that, and the same eviction keeps it
 * inside the origin's budget. A browser that refuses localStorage (private
 * modes do) falls back to the per-tab store rather than losing the cache.
 * The remembered session boards (`sync/boardMemory.ts`) share this store and
 * its budget (owner, 2026-10-06).
 */
export function durablePageStorage(): HistoryStorage {
  const backing = durableStore() ?? perTabStore();
  return {
    getItem: (key) => backing.getItem(key),
    setItem: (key, value) => { backing.setItem(key, value); },
    removeItem: (key) => { backing.removeItem(key); },
    keys: () => {
      const keys: string[] = [];
      for (let index = 0; index < backing.length; index += 1) {
        const key = backing.key(index);
        if (key !== null) keys.push(key);
      }
      return keys;
    },
  };
}

function durableStore(): Storage | undefined {
  try {
    const probe = `${CACHE_PREFIX}probe`;
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return undefined;
  }
}

function perTabStore(): Storage {
  return sessionStorage;
}

export interface RawMessagePage {
  messages: unknown[];
  start: number;
  total: number;
}

export interface CachedChatHistory extends RawMessagePage {
  savedAt: number;
}

export function readChatHistoryCache(sessionId: string, storage: HistoryStorage = durablePageStorage()): RawMessagePage | undefined {
  try {
    const raw = storage.getItem(cacheKey(sessionId));
    if (raw === null || raw === "") return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!isCachedHistory(parsed)) return undefined;
    if (Date.now() - parsed.savedAt > CACHE_TTL_MS) {
      storage.removeItem(cacheKey(sessionId));
      return undefined;
    }
    return { messages: parsed.messages, start: parsed.start, total: parsed.total };
  } catch {
    return undefined;
  }
}

/** Keys an older build wrote for the retired delta replay (sync-convergence phase B); nothing reads them. */
const RETIRED_PREFIXES = ["pi-web:chat-watermark:v1:"];
let retiredKeysSwept = false;

/** Remove the retired keys once per page, so they stop taking room the page cache competes for. */
function sweepRetiredKeys(storage: HistoryStorage): void {
  if (retiredKeysSwept) return;
  retiredKeysSwept = true;
  try {
    for (const key of storage.keys()) if (RETIRED_PREFIXES.some((prefix) => key.startsWith(prefix))) storage.removeItem(key);
  } catch {
    return;
  }
}

export function writeChatHistoryCache(sessionId: string, page: RawMessagePage, storage: HistoryStorage = durablePageStorage()): void {
  sweepRetiredKeys(storage);
  const payload = JSON.stringify({ ...page, savedAt: Date.now() });
  // A page too large for one entry is trimmed to its tail, which is the part a
  // reader lands on. Caching nothing was the old answer and it made the biggest
  // transcripts the slowest ones.
  const stored = fitToEntry(page, payload);
  if (stored === undefined) return;
  if (trySet(storage, sessionId, stored)) return;
  // Out of room: drop other sessions' pages, oldest first, and try again.
  for (const key of evictionOrder(storage, cacheKey(sessionId))) {
    try { storage.removeItem(key); } catch { return; }
    if (trySet(storage, sessionId, stored)) return;
  }
}

/**
 * Trim from the front until the page fits one entry. A transcript is read from
 * the bottom, so the tail is the part worth keeping; caching nothing was the
 * old answer and it made the biggest transcripts the slowest ones.
 */
function fitToEntry(page: RawMessagePage, payload: string): string | undefined {
  if (payload.length <= MAX_ENTRY_BYTES) return payload;
  let candidate = page;
  while (candidate.messages.length > 1) {
    candidate = tailOf(candidate);
    const trimmed = JSON.stringify({ ...candidate, savedAt: Date.now() });
    if (trimmed.length <= MAX_ENTRY_BYTES) return trimmed;
  }
  return undefined;
}

function trySet(storage: HistoryStorage, sessionId: string, payload: string): boolean {
  try {
    storage.setItem(cacheKey(sessionId), payload);
    return true;
  } catch {
    return false;
  }
}

/**
 * Make room for another cache in the shared store by dropping the oldest
 * transcript page. False when there is none left to drop.
 */
export function evictOldestChatHistory(storage: HistoryStorage): boolean {
  const oldest = evictionOrder(storage, undefined)[0];
  if (oldest === undefined) return false;
  try {
    storage.removeItem(oldest);
    return true;
  } catch {
    return false;
  }
}

/** Other sessions' cached pages, oldest first. Never the one being written, when one is. */
function evictionOrder(storage: HistoryStorage, keepKey: string | undefined): string[] {
  const entries: { key: string; savedAt: number }[] = [];
  try {
    for (const key of storage.keys()) {
      if (!key.startsWith(CACHE_PREFIX) || key === keepKey) continue;
      let savedAt = 0;
      try {
        const parsed: unknown = JSON.parse(storage.getItem(key) ?? "null");
        if (isCachedHistory(parsed)) savedAt = parsed.savedAt;
      } catch { savedAt = 0; }
      entries.push({ key, savedAt });
    }
  } catch { return []; }
  return entries.sort((left, right) => left.savedAt - right.savedAt).map((entry) => entry.key);
}

/**
 * Keys, however this storage implementation exposes them. Some environments
 * answer through the indexed accessor and some only enumerate.
 */

/**
 * The tail of a page: a transcript is read from the bottom, so when only part
 * of one fits, the part worth keeping is the end.
 */
function tailOf(page: RawMessagePage): RawMessagePage {
  const half = Math.max(1, Math.floor(page.messages.length / 2));
  const messages = page.messages.slice(page.messages.length - half);
  return { messages, start: page.start + (page.messages.length - half), total: page.total };
}

export function removeChatHistoryCache(sessionId: string, storage: HistoryStorage = durablePageStorage()): void {
  try {
    storage.removeItem(cacheKey(sessionId));
  } catch {
    // Ignore storage access errors; cache may simply be unavailable.
  }
}

export function mergeChatHistory(existing: RawMessagePage | undefined, incoming: RawMessagePage): RawMessagePage {
  if (existing === undefined || !isValidMessagePage(existing)) return incoming;
  if (!isValidMessagePage(incoming)) return existing;
  if (isCompleteReplacement(existing, incoming)) return incoming;

  const start = Math.min(existing.start, incoming.start);
  const end = Math.max(existing.start + existing.messages.length, incoming.start + incoming.messages.length);
  const messages = new Array<unknown>(end - start);
  copyInto(messages, start, existing);
  copyInto(messages, start, incoming);

  if (hasSparseEntries(messages)) return incoming;
  return { start, total: Math.max(existing.total, incoming.total), messages };
}

function isCompleteReplacement(existing: RawMessagePage, incoming: RawMessagePage): boolean {
  return existing.total > incoming.total && existing.start === 0 && incoming.start === 0 && incoming.messages.length === incoming.total;
}

function hasSparseEntries(messages: unknown[]): boolean {
  for (let index = 0; index < messages.length; index += 1) {
    if (!(index in messages) || messages[index] === undefined) return true;
  }
  return false;
}

function copyInto(target: unknown[], targetStart: number, page: RawMessagePage): void {
  page.messages.forEach((message, index) => {
    target[page.start - targetStart + index] = message;
  });
}

function cacheKey(sessionId: string): string {
  return `${CACHE_PREFIX}${sessionId}`;
}

function isCachedHistory(value: unknown): value is CachedChatHistory {
  if (typeof value !== "object" || value === null) return false;
  if (!("messages" in value) || !("start" in value) || !("total" in value) || !("savedAt" in value)) return false;
  const { messages, start, total, savedAt } = value;
  return Array.isArray(messages)
    && typeof start === "number"
    && typeof total === "number"
    && typeof savedAt === "number"
    && isValidMessagePage({ messages, start, total });
}

function isValidMessagePage(page: RawMessagePage): boolean {
  return Number.isInteger(page.start)
    && Number.isInteger(page.total)
    && page.start >= 0
    && page.total >= page.start
    && page.messages.length <= page.total - page.start
    && !page.messages.some(isNormalizedChatLine);
}

function isNormalizedChatLine(value: unknown): boolean {
  return typeof value === "object"
    && value !== null
    && "role" in value
    && "parts" in value
    && !("content" in value)
    && typeof value.role === "string"
    && Array.isArray(value.parts);
}
