import { describe, expect, it } from "vitest";
import { shouldRequestNewerMessages, doesNotFillViewport, isNearTop } from "./chatHistoryLoading";

describe("chat history loading decisions", () => {
  it("uses a small tolerance for underfilled viewports", () => {
    expect(doesNotFillViewport({ scrollHeight: 501, clientHeight: 500 })).toBe(true);
    expect(doesNotFillViewport({ scrollHeight: 502, clientHeight: 500 })).toBe(false);
  });

  it("keeps a screen and a half loaded ahead of the reader", () => {
    expect(isNearTop({ scrollTop: 1199, clientHeight: 800 })).toBe(true);
    expect(isNearTop({ scrollTop: 1200, clientHeight: 800 })).toBe(false);
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
