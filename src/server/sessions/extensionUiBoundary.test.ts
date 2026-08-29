import { describe, expect, it } from "vitest";

import { unsupportedSurfaceNotice } from "./extensionUiBoundary.js";

describe("what the browser hears when an extension asks for an undrawable interface", () => {
  it("names the surface and the way out instead of staying silent", () => {
    const notice = unsupportedSurfaceNotice("ui.custom");

    expect(notice).toContain("ui.custom");
    expect(notice).toContain("cancelled");
    expect(notice).toMatch(/TUI/u);
  });
});
