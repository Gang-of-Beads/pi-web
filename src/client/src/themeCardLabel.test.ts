import { describe, expect, it } from "vitest";
import { themeCardSuffix } from "./themeCardLabel.js";

/**
 * "Clay Paper is selected but the interface is dark - is that right?"
 *
 * It was right, and unsayable from the screen. Following the system was on, so
 * the dark half of the pair was rendered, and only that other card said "in
 * use". The card the reader had actually picked said nothing, so the only way
 * to learn the rule was to infer it.
 */

describe("what a theme card says", () => {
  it("tells the chosen card that the system is overriding it", () => {
    expect(themeCardSuffix({ selected: true, active: false, autoOverriding: true })).toBe(" · chosen, but following your system");
  });

  it("marks the card actually in use when it is not the chosen one", () => {
    expect(themeCardSuffix({ selected: false, active: true, autoOverriding: false })).toBe(" · in use");
  });

  it("says nothing extra when the chosen card is the one in use", () => {
    expect(themeCardSuffix({ selected: true, active: true, autoOverriding: false })).toBe("");
  });

  it("says nothing about a card that is neither", () => {
    expect(themeCardSuffix({ selected: false, active: false, autoOverriding: false })).toBe("");
  });

  /** Both cards speak, so the pair is legible from either side. */
  it("never leaves an overridden pair with only one card explaining it", () => {
    const chosen = themeCardSuffix({ selected: true, active: false, autoOverriding: true });
    const inUse = themeCardSuffix({ selected: false, active: true, autoOverriding: false });
    expect(chosen).not.toBe("");
    expect(inUse).not.toBe("");
  });
});
