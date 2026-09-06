// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { HISTORY_COALESCE_MS, clearPlaceholderFrame, historyWriteMode, notePlaceholderFrame, placeholderFrameOutstanding, writeRouteUrl } from "./historyWrites";

afterEach(() => {
  clearPlaceholderFrame();
  window.history.replaceState({}, "", "/");
});

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

describe("the frames a forced settings push leaves behind", () => {
  /**
   * Settings writes force a push so the 400ms coalesce window cannot fold a
   * drilled section frame into the list frame. An outstanding modal
   * placeholder still wins: pushing past it would leave a stray frame whose
   * only content is the modal state, and the next back would land on it and
   * swallow the tap.
   */
  it("pushes a forced settings write as its own frame", () => {
    const before = window.history.length;
    writeRouteUrl("/?settings", false, 1000, true);
    expect(window.history.length).toBe(before + 1);
    expect(window.location.search).toBe("?settings");
  });

  it("lets a modal placeholder frame take the forced write instead", () => {
    notePlaceholderFrame();
    const before = window.history.length;
    writeRouteUrl("/?settings=machines", false, 1000, true);
    expect(window.history.length).toBe(before);
    expect(window.location.search).toBe("?settings=machines");
  });

  it("reports whether a modal placeholder frame is still outstanding", () => {
    expect(placeholderFrameOutstanding()).toBe(false);
    notePlaceholderFrame();
    expect(placeholderFrameOutstanding()).toBe(true);
    clearPlaceholderFrame();
    expect(placeholderFrameOutstanding()).toBe(false);
  });

  it("consumes the outstanding placeholder with any route write", () => {
    notePlaceholderFrame();
    writeRouteUrl("/?settings", false, 1000, true);
    expect(placeholderFrameOutstanding()).toBe(false);
  });
});
