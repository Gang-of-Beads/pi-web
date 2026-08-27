import { describe, expect, it } from "vitest";
import { HISTORY_COALESCE_MS, historyWriteMode } from "./historyWrites";

describe("the history left behind by one action", () => {
  /**
   * Opening a tool writes the tool, the view and the tool's own arguments as
   * separate URL updates. Each one pushed, so a single tap left six entries
   * behind and the back gesture had to be pressed six times to undo it. From
   * the outside that reads as back being broken.
   *
   * The first write of an action pushes; the rest of that action replaces.
   */
  it("pushes the first write", () => {
    expect(historyWriteMode({ lastWriteAt: undefined, now: 1000 })).toBe("push");
  });

  it("replaces the writes that belong to the same action", () => {
    expect(historyWriteMode({ lastWriteAt: 1000, now: 1000 + HISTORY_COALESCE_MS - 1 })).toBe("replace");
  });

  it("pushes again once the action is over", () => {
    expect(historyWriteMode({ lastWriteAt: 1000, now: 1000 + HISTORY_COALESCE_MS })).toBe("push");
  });

  /**
   * Opening a sheet pushes a placeholder frame so the back gesture closes the
   * sheet instead of leaving the session. Choosing something from that sheet
   * then wrote the route as a second entry, so leaving a tool took two back
   * presses and the first one looked like nothing happened.
   *
   * A choice takes the place of the frame its own sheet pushed.
   */
  it("takes the place of the frame its sheet pushed", () => {
    expect(historyWriteMode({ lastWriteAt: undefined, now: 5000, placeholderOutstanding: true })).toBe("replace");
  });
});
