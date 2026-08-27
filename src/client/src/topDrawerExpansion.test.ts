import { describe, expect, it } from "vitest";
import { dropsExpansionAsWorkFinishes } from "./topDrawerExpansion";

describe("an activity drawer opened to watch running work", () => {
  /**
   * The drawer starts folded, but opening it was permanent: the reader opened
   * it to watch a subagent, and it stayed open for the rest of the chat. On a
   * tab left open for days that means always open, holding a block of screen
   * to report "Nothing running right now."
   *
   * The reason to be open is the work. When the work ends, so does the reason.
   */
  it("folds itself when the last of the work finishes", () => {
    expect(dropsExpansionAsWorkFinishes({ wasWorking: true, working: false })).toBe(true);
  });

  it("stays open while the work is still running", () => {
    expect(dropsExpansionAsWorkFinishes({ wasWorking: true, working: true })).toBe(false);
  });

  /**
   * Opening the drawer while nothing is running is a deliberate request to
   * read finished output. Folding it then would take the panel away from a
   * reader who just asked for it.
   */
  it("leaves a drawer opened over finished work alone", () => {
    expect(dropsExpansionAsWorkFinishes({ wasWorking: false, working: false })).toBe(false);
  });

  it("leaves a drawer opened as work starts alone", () => {
    expect(dropsExpansionAsWorkFinishes({ wasWorking: false, working: true })).toBe(false);
  });
});
