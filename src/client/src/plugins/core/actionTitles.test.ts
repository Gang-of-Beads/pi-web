import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCoreActions } from "./actions";

/**
 * Words that are capitalised because of what they are, not because of where
 * they sit in a title: the product name and its parts.
 */
const PROPER_NOUNS = new Set(["PI", "WEB", "Pi"]);

function titleCasedWords(title: string): string[] {
  return title
    .split(" ")
    .slice(1)
    .filter((word) => !PROPER_NOUNS.has(word))
    .filter((word) => /^[A-Z]/u.test(word));
}

describe("how the app capitalises the things it can do", () => {
  /**
   * The same action was written two ways depending on the surface: the palette
   * offered "New Session" and "Clean Up Sessions" while the session list beside
   * it offered "New session" and "Clean up". A reader scanning both saw two
   * conventions and no reason for either.
   */
  it("names every core action in sentence case", () => {
    const offenders = createCoreActions()
      .map((action) => action.title)
      .filter((title) => titleCasedWords(title).length > 0);

    expect(offenders).toEqual([]);
  });

  it("keeps the product name capitalised", () => {
    const titles = createCoreActions().map((action) => action.title);

    expect(titles).toContain("Open selected machine PI WEB");
  });
});

describe("how the app writes a trailing ellipsis", () => {
  /**
   * The palette's search box used three ASCII periods while every other
   * waiting or continuing label in the app uses the real character, so the one
   * control a reader opens first was the one that looked unfinished.
   */
  it("uses the ellipsis character rather than three periods", () => {
    const palette = readFileSync(join(process.cwd(), "src/client/src/components/ActionPalette.ts"), "utf8");

    expect(palette).toContain("Search actions\u2026");
    expect(palette).not.toContain("Search actions...");
  });
});
