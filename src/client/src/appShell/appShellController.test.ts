import { describe, expect, it } from "vitest";
import { autoFocusesComposer } from "./appShellController";
import { defaultRouteView } from "./appShellController";

describe("defaultRouteView", () => {
  it("opens the conversation a link names, on any layout", () => {
    // A shared link that names a session has already said what to show. The
    // narrow layout used to ignore that and open the session list, leaving the
    // session it named one tap away - while the same link opened the
    // conversation directly on a wide layout.
    expect(defaultRouteView(true, { sessionId: "01a0" })).toBe("chat");
    expect(defaultRouteView(false, { sessionId: "01a0" })).toBe("chat");
  });

  it("opens navigation on a narrow layout when the link names no session", () => {
    expect(defaultRouteView(true, {})).toBe("navigation");
    expect(defaultRouteView(true, { sessionId: "" })).toBe("navigation");
    expect(defaultRouteView(true, { sessionId: undefined })).toBe("navigation");
  });

  it("opens the chat on a wide layout regardless", () => {
    expect(defaultRouteView(false, {})).toBe("chat");
  });
});

describe("raising the keyboard where a finger is the pointer", () => {
  /**
   * The rule already withheld focus on a phone layout and in a PWA, but it was
   * checked at one of the four places that focus the composer. Switching
   * session, closing a dialog, and restoring a queued message all reached for
   * the composer directly, so the on-screen keyboard came up over the
   * conversation the reader had just navigated to.
   *
   * Which pointer the device leads with decides it, rather than how wide the
   * window is: a narrow desktop window still has a keyboard attached, and a
   * tablet in landscape does not.
   */
  it("withholds focus from a touch device however wide it is", () => {
    expect(autoFocusesComposer({ touchPrimary: true, modalOpen: false })).toBe(false);
  });

  it("focuses the composer where typing is the way in", () => {
    expect(autoFocusesComposer({ touchPrimary: false, modalOpen: false })).toBe(true);
  });

  /**
   * A dialog owns focus while it is open; stealing it would take the keys away
   * from whatever the reader is answering.
   */
  it("never takes focus from an open dialog", () => {
    expect(autoFocusesComposer({ touchPrimary: false, modalOpen: true })).toBe(false);
  });
});
