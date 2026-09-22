// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { readChatHistoryCache, writeChatHistoryCache } from "./chatHistoryCache";

/**
 * Owner report: opening a session always rebuilt its transcript from scratch.
 * The cache was kept in sessionStorage, which a phone empties whenever the
 * browser reclaims the tab, so the hit rate for the case that matters -
 * coming back to a conversation later - was zero.
 */
const page = { messages: [{ role: "user", content: "hello" }], start: 0, total: 1 };

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("where the transcript cache lives", () => {
  it("survives the tab that wrote it", () => {
    writeChatHistoryCache("session-1", page);

    expect(localStorage.getItem("pi-web:chat-history:v2:session-1"), "a page kept only per tab is lost on the phone").not.toBeNull();
    sessionStorage.clear();

    expect(readChatHistoryCache("session-1")).toMatchObject({ total: 1 });
  });

  it("falls back to the per-tab store when the durable one is refused", () => {
    const refusing = {
      getItem: () => null,
      setItem: () => { throw new Error("private mode"); },
      removeItem: () => undefined,
      key: () => null,
      clear: () => undefined,
      length: 0,
    };
    vi.stubGlobal("localStorage", refusing);

    writeChatHistoryCache("session-2", page);

    expect(readChatHistoryCache("session-2")).toMatchObject({ total: 1 });
    expect(sessionStorage.getItem("pi-web:chat-history:v2:session-2")).not.toBeNull();
  });

  it("keeps a page long enough to be worth having", () => {
    const stored: unknown = JSON.parse(localStorage.getItem("pi-web:chat-history:v2:session-3") ?? "null");
    expect(stored).toBeNull();
    writeChatHistoryCache("session-3", page);
    const written: unknown = JSON.parse(localStorage.getItem("pi-web:chat-history:v2:session-3") ?? "null");
    const savedAt: unknown = typeof written === "object" && written !== null ? Reflect.get(written, "savedAt") : undefined;
    expect(typeof savedAt).toBe("number");

    // An hour later the page is still a hit: staleness costs one delta read,
    // a miss costs the whole transcript.
    vi.setSystemTime(new Date(Date.now() + 60 * 60 * 1000));
    expect(readChatHistoryCache("session-3")).toMatchObject({ total: 1 });
    vi.useRealTimers();
  });
});
