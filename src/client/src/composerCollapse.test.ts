// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { composerCollapsedForFocus, shouldReleaseComposerCollapse } from "./composerCollapse";

function path(...tags: string[]): EventTarget[] {
  return tags.map((tag) => document.createElement(tag));
}

describe("shouldReleaseComposerCollapse", () => {
  /**
   * Caught live: the updater dialog answered and REMOVED while its field held
   * focus — no focusout fires on removal, so the composer stayed a one-line
   * loan and the reader's next tap read as "my first tap did nothing". The
   * loan ends when the surfaces that cause collapsing are gone and focus is
   * not inside another one.
   */
  it("releases the loan when the collapsing host is gone and focus is elsewhere", () => {
    expect(shouldReleaseComposerCollapse({ collapsed: true, collapsingHostStillPresent: false, activeElementPath: path("body") })).toBe(true);
  });

  it("keeps the loan while another collapsing host holds focus", () => {
    expect(shouldReleaseComposerCollapse({ collapsed: true, collapsingHostStillPresent: false, activeElementPath: path("textarea", "ask-user-card") })).toBe(false);
  });

  it("keeps the loan while the same host is still in the DOM", () => {
    expect(shouldReleaseComposerCollapse({ collapsed: true, collapsingHostStillPresent: true, activeElementPath: path("body") })).toBe(false);
  });

  it("is a no-op for an already-expanded composer", () => {
    expect(shouldReleaseComposerCollapse({ collapsed: false, collapsingHostStillPresent: false, activeElementPath: path("body") })).toBe(false);
  });
});

describe("composerCollapsedForFocus", () => {
  // The composer plus its action row is about a third of a phone screen above
  // the keyboard, and none of it is usable while a question form is answered.
  it("collapses for a question form or an extension dialog field", () => {
    expect(composerCollapsedForFocus(path("textarea", "ask-user-card"))).toBe(true);
    expect(composerCollapsedForFocus(path("input", "extension-dialog-card"))).toBe(true);
  });

  it("leaves the composer alone for its own field and for the transcript", () => {
    expect(composerCollapsedForFocus(path("textarea", "prompt-editor"))).toBe(false);
    expect(composerCollapsedForFocus(path("div", "chat-view"))).toBe(false);
    expect(composerCollapsedForFocus([])).toBe(false);
  });

  it("ignores non-element targets such as the window", () => {
    expect(composerCollapsedForFocus([window, document])).toBe(false);
  });
});
