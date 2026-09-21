// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { ChatView } from "./ChatView";

/**
 * Owner report: the transcript jolted at the end of a scroll. The scroll rail
 * grew from 0 to 6px with the gesture and shrank back afterwards, so the
 * content box changed width twice and every message re-wrapped. The rail's
 * width is a constant; only its colour answers the gesture.
 */
function chatViewCss(): string {
  const styles = ChatView.styles;
  const sheets = Array.isArray(styles) ? styles : [styles];
  return sheets.map((sheet) => String(sheet)).join("\n");
}

describe("the transcript's scroll rail", () => {
  it("reserves its gutter at all times", () => {
    const css = chatViewCss();
    expect(css).toContain("scrollbar-gutter: stable");
    expect(css).toMatch(/\.chat::-webkit-scrollbar \{ width: 6px;/u);
  });

  it("never changes the rail's width for the scrolling state", () => {
    const css = chatViewCss();
    const scrollingRules = css
      .split("\n")
      .filter((line) => line.includes(":host([scrolling])"));

    expect(scrollingRules.length).toBeGreaterThan(0);
    for (const rule of scrollingRules) {
      expect(rule).not.toMatch(/width:/u);
      expect(rule).not.toMatch(/scrollbar-width:/u);
    }
  });
});
