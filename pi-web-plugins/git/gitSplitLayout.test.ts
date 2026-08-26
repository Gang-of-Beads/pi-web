import { describe, expect, it } from "vitest";
import { gitSplitClass } from "./browser/gitSplitLayout.js";

describe("the git panel's split", () => {
  /**
   * The split gave the file list a third of the height and the viewer the
   * rest, at every size. On a phone that showed four changed files in a pane
   * with room for a dozen, above two thirds of a screen reading "Select a
   * changed file" - two stretches of empty space stacked on top of each other,
   * and no way to see more of either.
   *
   * With nothing selected there is no second pane to show, so the list should
   * have the screen.
   */
  it("gives the list the whole panel while no file is chosen", () => {
    expect(gitSplitClass(undefined)).toBe("git-split list-only");
  });

  it("splits once a file is chosen", () => {
    expect(gitSplitClass("src/app.ts")).toBe("git-split");
  });
});
