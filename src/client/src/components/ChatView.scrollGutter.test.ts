// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { ChatView } from "./ChatView";
import { pageScrollerStyles } from "./shared";

afterEach(() => {
  document.body.replaceChildren();
});

/**
 * Owner reports: the transcript jolted at the end of a scroll when its rail
 * grew with the gesture, and once the rail's width was reserved instead, the
 * messages' right edge sat that width inside the context bar and composer on
 * every platform that draws classic scrollbars. The owner chose to draw no
 * scrollbar at all (2026-10-16), so the column has one right edge; every
 * whole-page scroller now shares that rule (2026-10-21).
 */
function chatViewCss(): string {
  const styles = ChatView.styles;
  const sheets = Array.isArray(styles) ? styles : [styles];
  return sheets.map((sheet) => String(sheet)).join("\n");
}

describe("the transcript's scroll rail", () => {
  it("is not drawn and reserves no gutter", async () => {
    const view = new ChatView();
    document.body.append(view);
    await view.updateComplete;

    expect(view.renderRoot.querySelector(".chat")?.classList.contains("page-scroller")).toBe(true);
    expect(chatViewCss()).toContain(String(pageScrollerStyles));
    expect(String(pageScrollerStyles)).toMatch(/@media \(forced-colors: none\) \{[^}]*scrollbar-width: none;[^}]*\}\s*\.page-scroller::-webkit-scrollbar \{ display: none; \}/u);
    expect(chatViewCss()).not.toContain("scrollbar-gutter");
    expect(String(pageScrollerStyles)).not.toContain("scrollbar-gutter");
  });

  it("has no :host([scrolling]) rule", () => {
    expect(chatViewCss()).not.toContain(":host([scrolling])");
  });
});
