import { describe, expect, it } from "vitest";
import { BANNER_MIN_VISIBLE_MS, bannerHoldDecision } from "./bannerHold";

describe("a banner that keeps appearing and withdrawing", () => {
  /**
   * Retries set and clear the error in quick succession. Each change resized
   * the column and shoved the conversation: measured 21 shifts and 1.019
   * cumulative over six seconds, against the 0.1 that reads as steady. The
   * reader could not read or aim at anything.
   *
   * Floating it over the column was tried and rejected: at the top it covered
   * the context bar, which is what says which session you are in.
   *
   * So the banner holds its place instead. Appearing is immediate - a failure
   * should not wait to be reported - but withdrawing waits until it has been
   * on screen long enough to read.
   */
  it("shows a new message at once", () => {
    expect(bannerHoldDecision({ shownAt: undefined, now: 1000, next: "boom" })).toEqual({ kind: "show", text: "boom" });
  });

  it("holds an established banner rather than withdrawing it immediately", () => {
    const decision = bannerHoldDecision({ shownAt: 1000, now: 1200, next: "" });

    expect(decision).toEqual({ kind: "hold", retryInMs: BANNER_MIN_VISIBLE_MS - 200 });
  });

  it("withdraws once it has been readable long enough", () => {
    expect(bannerHoldDecision({ shownAt: 1000, now: 1000 + BANNER_MIN_VISIBLE_MS, next: "" })).toEqual({ kind: "hide" });
  });

  /**
   * A different failure replaces the text in place: the row is already there,
   * so swapping its words costs no layout.
   */
  it("replaces the text of a banner already on screen", () => {
    expect(bannerHoldDecision({ shownAt: 1000, now: 1100, next: "worse" })).toEqual({ kind: "show", text: "worse" });
  });
});
