const CACHE_PREFIX = "pi-web:chat-history:v2:";
const CACHE_TTL_MS = 30 * 60 * 1000;

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

function browserStorage(): HistoryStorage {
  return {
    getItem: (key) => sessionStorage.getItem(key),
    setItem: (key, value) => { sessionStorage.setItem(key, value); },
    removeItem: (key) => { sessionStorage.removeItem(key); },
    keys: () => {
      const keys: string[] = [];
      for (let index = 0; index < sessionStorage.length; index += 1) {
        const key = sessionStorage.key(index);
        if (key !== null) keys.push(key);
      }
      return keys;
    },
  };
}

export interface RawMessagePage {
  messages: unknown[];
  start: number;
  total: number;
}

export interface CachedChatHistory extends RawMessagePage {
  savedAt: number;
}

export function readChatHistoryCache(sessionId: string, storage: HistoryStorage = browserStorage()): RawMessagePage | undefined {
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

export function writeChatHistoryCache(sessionId: string, page: RawMessagePage, storage: HistoryStorage = browserStorage()): void {
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

/** Other sessions' cached pages, oldest first. Never the one being written. */
function evictionOrder(storage: HistoryStorage, keepKey: string): string[] {
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

export function removeChatHistoryCache(sessionId: string, storage: HistoryStorage = browserStorage()): void {
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

const WATERMARK_PREFIX = "pi-web:chat-watermark:v1:";

function watermarkKey(sessionId: string): string {
  return `${WATERMARK_PREFIX}${sessionId}`;
}

/**
 * The stream seq of the snapshot a cached page was read against. The delta
 * replay path replays frames after this seq onto the cached page; the pair
 * (page, watermark) is only meaningful together, so a missing page makes the
 * watermark ignorable.
 */
export function readChatHistoryWatermark(sessionId: string, storage: HistoryStorage = browserStorage()): number | undefined {
  try {
    const raw = storage.getItem(watermarkKey(sessionId));
    if (raw === null || raw === "") return undefined;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function writeChatHistoryWatermark(sessionId: string, seq: number, storage: HistoryStorage = browserStorage()): void {
  try {
    storage.setItem(watermarkKey(sessionId), JSON.stringify(seq));
  } catch {
    // A watermark the storage refuses is a lost optimization, not a failure.
  }
}

export function removeChatHistoryWatermark(sessionId: string, storage: HistoryStorage = browserStorage()): void {
  try {
    storage.removeItem(watermarkKey(sessionId));
  } catch {
    // Ignore storage access errors; cache may simply be unavailable.
  }
}
