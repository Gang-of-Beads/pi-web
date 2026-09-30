// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { navigationKeyLabel } from "./AppContextBar";

/**
 * Owner report: "the three bars should be the Go to menu, and the four squares the navigation page for
 * picking machine/project/session on the left" - the desktop had grown a lone hamburger that toggled a panel,
 * so the same two glyphs meant different things depending on the width. The
 * meanings are fixed now; only the wording follows the surface each layout
 * actually opens.
 */
describe("what the navigation key says", () => {
  it("names the page on a layout that takes the screen", () => {
    expect(navigationKeyLabel("page", false)).toBe("Open navigation");
    expect(navigationKeyLabel("page", true)).toBe("Open navigation");
  });

  it("names the side it is about to change on a layout that keeps a panel", () => {
    expect(navigationKeyLabel("panel", false)).toBe("Open navigation panel");
    expect(navigationKeyLabel("panel", true)).toBe("Close navigation panel");
  });
});
