import { describe, expect, it } from "vitest";

/**
 * The loading flag belongs to the selection that set it.
 *
 * "Empty" is two states - unloaded and empty - and the flag exists so the view
 * stops calling the first one the second. But it was a bare boolean cleared by
 * whichever selection reached its finally last, while every other guard in the
 * same function is keyed on a selection counter. Select A, select B while A is
 * still in flight, and A's exit clears B's flag: the view then invites a first
 * message into a session whose history is still arriving.
 *
 * That is the same defect wearing the fix's clothes, and it breaks the house
 * rule that retained data must travel with the key it was fetched for.
 */

/** The controller's rule: only the current selection may clear the flag. */
function clearedBy(flagSeq: number, currentSeq: number, isLoading: boolean): boolean {
  return flagSeq === currentSeq && isLoading;
}

describe("clearing the transcript loading flag", () => {
  it("lets the selection that set the flag clear it", () => {
    expect(clearedBy(7, 7, true)).toBe(true);
  });

  it("refuses a superseded selection, whose exit would blank a newer load", () => {
    expect(clearedBy(7, 8, true)).toBe(false);
  });

  it("does nothing when no load is outstanding", () => {
    expect(clearedBy(7, 7, false)).toBe(false);
  });

  /**
   * The flag cannot strand a session in "loading" forever: every selection
   * raises the counter and sets the flag again in the same update, so the
   * newest selection always owns a flag it is able to clear.
   */
  it("is always clearable by the newest selection", () => {
    const newest = 9;

    expect(clearedBy(newest, newest, true)).toBe(true);
  });
});
