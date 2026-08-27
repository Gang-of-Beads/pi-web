// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_UI_SCALE,
  MAX_UI_SCALE,
  MIN_UI_SCALE,
  UI_SCALE_STORAGE_KEY,
  applyUiScale,
  clampUiScale,
  readStoredUiScale,
  uiScaleLabel,
  writeStoredUiScale,
} from "./uiScale";

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.style.removeProperty("zoom");
});

describe("the interface size a device remembers", () => {
  it("refuses a size the interface cannot be used at", () => {
    // The value reaches the DOM, so a hand-edited storage entry or a stale
    // bookmark must not be able to render the app too small to click.
    expect(clampUiScale(0.1)).toBe(MIN_UI_SCALE);
    expect(clampUiScale(9)).toBe(MAX_UI_SCALE);
    expect(clampUiScale(Number.NaN)).toBe(DEFAULT_UI_SCALE);
  });

  it("keeps the value on the step and off the floating-point fringe", () => {
    // 1.1500000000000001 reaches the DOM as a zoom value and the label as
    // "115.00000000000001%".
    expect(clampUiScale(1.1499999)).toBe(1.15);
    expect(uiScaleLabel(clampUiScale(1.1499999))).toBe("115%");
    expect(clampUiScale(1.13)).toBe(1.15);
  });

  it("survives a reload through local storage, clamped on the way back", () => {
    writeStoredUiScale(1.25);
    expect(readStoredUiScale()).toBe(1.25);

    window.localStorage.setItem(UI_SCALE_STORAGE_KEY, "17");
    expect(readStoredUiScale()).toBe(MAX_UI_SCALE);

    window.localStorage.setItem(UI_SCALE_STORAGE_KEY, "not a number");
    expect(readStoredUiScale()).toBeUndefined();
  });

  it("leaves no zoom at all at the default size", () => {
    applyUiScale(1.2);
    expect(document.documentElement.style.getPropertyValue("zoom")).toBe("1.2");

    // Back to 100% has to remove the property, not set "1": a browser without
    // `zoom` should behave exactly as it did before the setting existed.
    applyUiScale(DEFAULT_UI_SCALE);
    expect(document.documentElement.style.getPropertyValue("zoom")).toBe("");
  });
});
