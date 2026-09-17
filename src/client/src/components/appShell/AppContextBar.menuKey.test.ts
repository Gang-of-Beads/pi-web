import { describe, expect, it } from "vitest";
import { panelToggleLabel } from "./AppContextBar";

describe("panelToggleLabel", () => {
  it("names the menu when the key opens the session menu", () => {
    expect(panelToggleLabel("menu", false)).toBe("Open session menu");
    expect(panelToggleLabel("menu", true)).toBe("Open session menu");
  });

  it("names the panel state when the key toggles the panel", () => {
    expect(panelToggleLabel("panel", false)).toBe("Open panel");
    expect(panelToggleLabel("panel", true)).toBe("Close panel");
  });
});
