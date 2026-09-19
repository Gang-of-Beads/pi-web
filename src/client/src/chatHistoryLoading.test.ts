import { describe, expect, it } from "vitest";
import { shouldRequestNewerMessages, doesNotFillViewport, isNearTop, shouldRequestEarlierMessages } from "./chatHistoryLoading";

describe("chat history loading decisions", () => {
  const base = {
    hasMore: true,
    loadingMore: false,
    canRequest: true,
    scrollTop: 200,
    scrollHeight: 1000,
    clientHeight: 500,
  };

  it("requests earlier messages near the top", () => {
    expect(shouldRequestEarlierMessages({ ...base, scrollTop: 20 })).toBe(true);
  });

  it("requests earlier messages when loaded content does not fill the viewport", () => {
    expect(shouldRequestEarlierMessages({ ...base, scrollHeight: 500, clientHeight: 500 })).toBe(true);
  });

  it("does not request while loading", () => {
    expect(shouldRequestEarlierMessages({ ...base, loadingMore: true, scrollTop: 0 })).toBe(false);
  });

  it("does not request when there is no earlier history", () => {
    expect(shouldRequestEarlierMessages({ ...base, hasMore: false, scrollTop: 0 })).toBe(false);
  });

  it("does not request when no callback is available", () => {
    expect(shouldRequestEarlierMessages({ ...base, canRequest: false, scrollTop: 0 })).toBe(false);
  });

  it("does not request while the scroll container is hidden", () => {
    expect(shouldRequestEarlierMessages({ ...base, scrollTop: 0, scrollHeight: 0, clientHeight: 0 })).toBe(false);
  });

  it("uses a small tolerance for underfilled viewports", () => {
    expect(doesNotFillViewport({ scrollHeight: 501, clientHeight: 500 })).toBe(true);
    expect(doesNotFillViewport({ scrollHeight: 502, clientHeight: 500 })).toBe(false);
  });

  it("keeps a screen and a half loaded ahead of the reader", () => {
    expect(isNearTop({ scrollTop: 1199, clientHeight: 800 })).toBe(true);
    expect(isNearTop({ scrollTop: 1200, clientHeight: 800 })).toBe(false);
  });

  it("allows a custom top threshold", () => {
    expect(isNearTop({ scrollTop: 80, clientHeight: 500, topThreshold: 100 })).toBe(true);
    expect(isNearTop({ scrollTop: 100, clientHeight: 500, topThreshold: 100 })).toBe(false);
  });
});

describe("shouldRequestNewerMessages", () => {
  const base = { hasNewer: true, loadingNewer: false, canRequest: true, scrollTop: 0, scrollHeight: 4000, clientHeight: 800 };

  it("fetches the next screen before the reader reaches the end", () => {
    expect(shouldRequestNewerMessages({ ...base, scrollTop: 2100 })).toBe(true);
  });

  it("stays quiet while the reader is still far from the end", () => {
    expect(shouldRequestNewerMessages({ ...base, scrollTop: 200 })).toBe(false);
  });

  it("asks for nothing when there is nothing newer, a read is in flight, or nobody can fetch", () => {
    expect(shouldRequestNewerMessages({ ...base, scrollTop: 3000, hasNewer: false })).toBe(false);
    expect(shouldRequestNewerMessages({ ...base, scrollTop: 3000, loadingNewer: true })).toBe(false);
    expect(shouldRequestNewerMessages({ ...base, scrollTop: 3000, canRequest: false })).toBe(false);
  });
});
