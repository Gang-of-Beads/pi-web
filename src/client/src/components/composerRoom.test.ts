import { describe, expect, it } from "vitest";
import { appStyles, promptEditorStyles } from "./shared";

const sheets = `${String(appStyles)}\n${String(promptEditorStyles)}`;

describe("what floats over the composer", () => {
  /**
   * The dictate and attach buttons are positioned over the bottom right corner
   * of the text area. The text area padded all four sides equally, so typed
   * text ran underneath them and the last words of a line were unreadable.
   *
   * Anything floating over an input has to be paid for in that input's padding.
   */
  it("keeps the text clear of the buttons over it", () => {
    const rule = /(?:^|\})\s*textarea\s*\{([^}]*)\}/mu.exec(sheets)?.[1] ?? "";

    expect(rule).toMatch(/padding-right/u);
  });
});

describe("the step footer of a question card", () => {
  /**
   * The footer used to stick to the bottom of the viewport, so options earlier
   * in the list scrolled underneath it: the reader could see an option's top
   * edge above the footer and its bottom edge below, with no scroll position
   * that showed the whole thing.
   *
   * Scroll margin was tried and only moves programmatic scrolling, not the
   * reader's own. A footer that does not overlap cannot hide anything.
   */
  it("does not float over the options", async () => {
    const { AskUserCard } = await import("./AskUserCard");
    const rule = /\.form-footer\s*\{([^}]*)\}/u.exec(String(AskUserCard.styles))?.[1] ?? "";

    expect(rule).not.toMatch(/position:\s*sticky/u);
  });
});
