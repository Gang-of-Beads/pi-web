import { describe, expect, it } from "vitest";
import { keyboardInset } from "./keyboardInset";

/**
 * The composer sits at the bottom of a fixed, 100dvh shell. A soft keyboard
 * shrinks only the visual viewport, so without this the send button ends up
 * underneath the keyboard — measured at y=799 with 519px visible.
 */
describe("keyboardInset", () => {
  it("reports the height a keyboard covers", () => {
    expect(keyboardInset(839, { height: 519, offsetTop: 0 })).toBe(320);
  });

  it("reports nothing when the viewports agree", () => {
    expect(keyboardInset(839, { height: 839, offsetTop: 0 })).toBe(0);
  });

  it("ignores a viewport scrolled down rather than shrunk", () => {
    // Scrolling under a collapsing URL bar offsets the visual viewport without
    // covering the bottom; treating that as a keyboard would shorten the shell
    // while the user is just scrolling.
    expect(keyboardInset(839, { height: 839, offsetTop: 60 })).toBe(0);
  });

  it("accounts for offset and shrink together", () => {
    // Keyboard up *and* the page scrolled: only the genuinely hidden part counts.
    expect(keyboardInset(839, { height: 500, offsetTop: 39 })).toBe(300);
  });

  it("ignores sub-pixel and few-pixel drift", () => {
    // Browsers report small differences during scroll momentum; reacting would
    // make the layout twitch.
    expect(keyboardInset(839, { height: 830, offsetTop: 0 })).toBe(0);
  });

  it("reports nothing when there is no visual viewport at all", () => {
    expect(keyboardInset(839, undefined)).toBe(0);
  });

  it("refuses implausible measurements instead of collapsing the shell", () => {
    expect(keyboardInset(0, { height: 519, offsetTop: 0 })).toBe(0);
    expect(keyboardInset(839, { height: 0, offsetTop: 0 })).toBe(0);
    expect(keyboardInset(839, { height: Number.NaN, offsetTop: 0 })).toBe(0);
  });

  it("never shortens the shell past its own height", () => {
    expect(keyboardInset(839, { height: 10, offsetTop: -5000 })).toBeLessThanOrEqual(839);
  });
});
