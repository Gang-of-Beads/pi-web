import { describe, expect, it } from "vitest";
import { dialogScreenKey } from "./dialogScreenKey.js";

describe("naming a keypress for a TUI component", () => {
  it("names the arrows, enter, escape and space", () => {
    expect(dialogScreenKey({ key: "ArrowUp" })).toBe("up");
    expect(dialogScreenKey({ key: "ArrowDown" })).toBe("down");
    expect(dialogScreenKey({ key: "Enter" })).toBe("enter");
    expect(dialogScreenKey({ key: "Escape" })).toBe("escape");
    expect(dialogScreenKey({ key: " " })).toBe("space");
    expect(dialogScreenKey({ key: "Backspace" })).toBe("backspace");
  });

  it("passes a single character through, upper case included", () => {
    expect(dialogScreenKey({ key: "y" })).toBe("y");
    expect(dialogScreenKey({ key: "Y" })).toBe("Y");
    expect(dialogScreenKey({ key: "1" })).toBe("1");
  });

  it("marks a modified letter and ignores a modifier on its own", () => {
    expect(dialogScreenKey({ key: "c", ctrlKey: true })).toBe("ctrl+c");
    expect(dialogScreenKey({ key: "Shift" })).toBeUndefined();
  });
});
