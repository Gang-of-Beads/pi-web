import { describe, expect, it } from "vitest";
import { isScreenHintLine, isSelectableLine, keysForLineTap, screenCursorLine, screenIsTappable } from "./dialogScreenKeys.js";

const menu = ["Task list confirmation", "▸ Confirm task list", "  Replace the current list", "  Keep current tasks"];

describe("driving a TUI screen from touch", () => {
  it("finds the component's own cursor line", () => {
    expect(screenCursorLine(menu)).toBe(1);
    expect(screenCursorLine(["plain", "text"])).toBeUndefined();
    expect(screenIsTappable(menu)).toBe(true);
    expect(screenIsTappable(["plain"])).toBe(false);
  });

  it("walks down to a line below the cursor and selects it", () => {
    expect(keysForLineTap(menu, 3)).toEqual(["down", "down", "enter"]);
  });

  it("walks up to a line above the cursor", () => {
    expect(keysForLineTap(menu, 0)).toEqual(["up", "enter"]);
  });

  it("just selects when the tap is the cursor's own line", () => {
    expect(keysForLineTap(menu, 1)).toEqual(["enter"]);
  });

  it("enters when the screen has no cursor at all", () => {
    expect(keysForLineTap(["a", "b"], 1)).toEqual(["enter"]);
  });

  it("skips blanks and the component's hint row", () => {
    expect(isSelectableLine("")).toBe(false);
    expect(isSelectableLine("   ")).toBe(false);
    expect(isSelectableLine("Enter to select · ↑↓ to navigate")).toBe(false);
    expect(isSelectableLine("▸ Confirm task list")).toBe(true);
  });
});

describe("the component's own key hint", () => {
  it("recognises the row that repeats what the buttons now do", () => {
    expect(isScreenHintLine("Enter to select · ↑↓ to navigate · Esc = back")).toBe(true);
    expect(isScreenHintLine("press any key · esc to close")).toBe(true);
  });

  it("keeps a real menu row that merely mentions a key", () => {
    expect(isScreenHintLine("▸ Confirm task list")).toBe(false);
    expect(isScreenHintLine("Esc to leave everything alone")).toBe(false);
  });
});
