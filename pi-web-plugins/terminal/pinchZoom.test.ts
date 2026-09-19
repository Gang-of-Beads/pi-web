import { describe, expect, it } from "vitest";
import { clampTerminalFontSize, pinchDistance, pinchFontSize, MAX_TERMINAL_FONT_SIZE, MIN_TERMINAL_FONT_SIZE } from "./pinchZoom";

describe("pinchDistance", () => {
  it("measures the span between two fingers", () => {
    expect(pinchDistance([{ clientX: 0, clientY: 0 }, { clientX: 3, clientY: 4 }])).toBe(5);
  });

  it("answers nothing for fewer than two fingers", () => {
    expect(pinchDistance([{ clientX: 0, clientY: 0 }])).toBeUndefined();
    expect(pinchDistance([])).toBeUndefined();
  });
});

describe("clampTerminalFontSize", () => {
  it("keeps the size inside the readable range", () => {
    expect(clampTerminalFontSize(2)).toBe(MIN_TERMINAL_FONT_SIZE);
    expect(clampTerminalFontSize(999)).toBe(MAX_TERMINAL_FONT_SIZE);
    expect(clampTerminalFontSize(Number.NaN)).toBe(MIN_TERMINAL_FONT_SIZE);
    expect(clampTerminalFontSize(13.4)).toBe(13);
  });
});

describe("pinchFontSize", () => {
  const state = { startDistance: 100, startFontSize: 12 };

  it("grows with the spread and shrinks with the pinch", () => {
    expect(pinchFontSize(state, 200, 12)).toBe(24);
    expect(pinchFontSize(state, 50, 12)).toBe(MIN_TERMINAL_FONT_SIZE);
  });

  it("says nothing while the gesture has not moved a whole pixel", () => {
    expect(pinchFontSize(state, 101, 12)).toBeUndefined();
  });

  it("refuses a gesture with no measurable start", () => {
    expect(pinchFontSize({ startDistance: 0, startFontSize: 12 }, 120, 12)).toBeUndefined();
  });
});
