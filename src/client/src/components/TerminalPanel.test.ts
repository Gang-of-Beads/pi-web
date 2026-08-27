import { describe, expect, it } from "vitest";
import { TerminalPanel } from "./TerminalPanel";

describe("the terminal's scrollbar", () => {
  /**
   * Two bars sat at the right edge of the terminal on a phone. xterm draws its
   * own 14px scrollbar into the scrollable element it manages, and the panel
   * additionally forced `overflow-y: scroll` on the viewport, which on a
   * platform with classic scrollbars paints a second, native one.
   *
   * Measured in the browser: the viewport's scrollHeight equals its
   * clientHeight, so that native bar is an empty track - it scrolls nothing,
   * because xterm scrolls its own element. Asking for it permanently is what
   * put it there.
   */
  it("does not ask for a second, permanent scrollbar", () => {
    const sheet = String(TerminalPanel.styles);
    const viewport = /\.xterm-viewport\s*\{([^}]*)\}/u.exec(sheet)?.[1] ?? "";

    expect(viewport).not.toMatch(/overflow-y:\s*scroll/u);
  });
});
