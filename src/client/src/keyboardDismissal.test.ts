import { describe, expect, it } from "vitest";
import { shouldDismissKeyboard } from "./keyboardDismissal";

/**
 * Opening a full-screen chooser while the composer still holds focus leaves
 * the on-screen keyboard up, covering the list the chooser exists to show. On
 * a phone that means the first thing after tapping "switch session" is to
 * dismiss a keyboard nobody asked for.
 *
 * Blurring is only right when something is actually focused and it is a text
 * field: taking focus off a button would lose the keyboard-navigation position
 * for someone using a physical keyboard, who has no on-screen keyboard in the
 * way to begin with.
 */
describe("dismissing the on-screen keyboard", () => {
  it("dismisses when a text input holds focus", () => {
    expect(shouldDismissKeyboard({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(shouldDismissKeyboard({ tagName: "TEXTAREA" })).toBe(true);
  });

  it("dismisses for an editable region, which is what the composer is", () => {
    expect(shouldDismissKeyboard({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("leaves a focused control alone, so keyboard navigation keeps its place", () => {
    expect(shouldDismissKeyboard({ tagName: "BUTTON" })).toBe(false);
    expect(shouldDismissKeyboard({ tagName: "DIV" })).toBe(false);
  });

  it("leaves a checkbox alone, which raises no keyboard", () => {
    expect(shouldDismissKeyboard({ tagName: "INPUT", type: "checkbox" })).toBe(false);
  });

  it("has nothing to dismiss when nothing is focused", () => {
    expect(shouldDismissKeyboard(undefined)).toBe(false);
  });
});
