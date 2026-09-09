// @vitest-environment node

import { describe, expect, it } from "vitest";
import { readChatHistoryCache, writeChatHistoryCache, type HistoryStorage } from "./chatHistoryCache.js";

/**
 * The cache used to give up silently.
 *
 * `writeChatHistoryCache` caught the quota error and did nothing else, so a
 * transcript large enough to exceed what was left of the origin's shared budget
 * was never cached at all - and those are precisely the sessions where
 * reopening is slow enough to notice. These cases run against a store with a
 * real capacity rather than a Storage stub, because the behaviour under test is
 * what happens when the store says no.
 */
function boundedStore(capacity: number): HistoryStorage & { evicted: string[] } {
  const entries = new Map<string, string>();
  const evicted: string[] = [];
  return {
    evicted,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      if (!entries.has(key) && entries.size >= capacity) {
        const error = new Error("QuotaExceededError");
        error.name = "QuotaExceededError";
        throw error;
      }
      entries.set(key, value);
    },
    removeItem: (key) => { if (entries.delete(key)) evicted.push(key); },
    keys: () => [...entries.keys()],
  };
}

function page(count: number, filler: string) {
  return { messages: Array.from({ length: count }, (_, index) => ({ id: index, text: filler })), start: 0, total: count };
}

describe("caching a transcript page", () => {
  it("caches a small page whole", () => {
    const store = boundedStore(4);
    writeChatHistoryCache("s1", page(10, "hello"), store);
    expect(readChatHistoryCache("s1", store)?.messages).toHaveLength(10);
  });

  it("keeps the tail of a page too large for one entry rather than caching nothing", () => {
    const store = boundedStore(4);
    writeChatHistoryCache("s2", page(400, "x".repeat(4000)), store);
    const cached = readChatHistoryCache("s2", store);
    expect(cached).toBeDefined();
    expect(cached?.messages.length).toBeGreaterThan(0);
    expect(cached?.messages.length).toBeLessThan(400);
    expect(cached?.total).toBe(400);
  });

  it("makes room by dropping another session's page instead of failing", () => {
    const store = boundedStore(1);
    writeChatHistoryCache("old", page(5, "a"), store);
    writeChatHistoryCache("new", page(5, "b"), store);

    expect(store.evicted).toEqual(["pi-web:chat-history:v2:old"]);
    expect(readChatHistoryCache("old", store)).toBeUndefined();
    expect(readChatHistoryCache("new", store)?.messages).toHaveLength(5);
  });

  it("evicts the oldest page first", () => {
    const store = boundedStore(2);
    writeChatHistoryCache("first", { ...page(2, "a"), start: 0 }, store);
    writeChatHistoryCache("second", page(2, "b"), store);
    store.setItem("pi-web:chat-history:v2:first", JSON.stringify({ ...page(2, "a"), savedAt: 1 }));
    store.setItem("pi-web:chat-history:v2:second", JSON.stringify({ ...page(2, "b"), savedAt: 2 }));

    writeChatHistoryCache("third", page(2, "c"), store);

    expect(store.evicted).toEqual(["pi-web:chat-history:v2:first"]);
    expect(readChatHistoryCache("third", store)?.messages).toHaveLength(2);
  });
});
