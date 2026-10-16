// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { ChatView } from "./ChatView";

/**
 * Owner reports: the transcript jolted at the end of a scroll when its rail
 * grew with the gesture, and once the rail's width was reserved instead, the
 * messages' right edge sat that width inside the context bar and composer on
 * every platform that draws classic scrollbars. The owner chose to draw no
 * scrollbar at all (2026-10-16), so the column has one right edge.
 */
function chatViewCss(): string {
  const styles = ChatView.styles;
  const sheets = Array.isArray(styles) ? styles : [styles];
  return sheets.map((sheet) => String(sheet)).join("\n");
}

describe("the transcript's scroll rail", () => {
  it("is not drawn and reserves no gutter", () => {
    const css = chatViewCss();
    expect(css).toContain("scrollbar-width: none");
    expect(css).toMatch(/\.chat::-webkit-scrollbar \{ display: none; \}/u);
    expect(css).not.toContain("scrollbar-gutter");
  });

  it("has no :host([scrolling]) rule", () => {
    expect(chatViewCss()).not.toContain(":host([scrolling])");
  });
});
