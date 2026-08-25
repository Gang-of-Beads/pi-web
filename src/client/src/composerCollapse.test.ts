// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { composerCollapsedForFocus } from "./composerCollapse";

function path(...tags: string[]): EventTarget[] {
  return tags.map((tag) => document.createElement(tag));
}

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
