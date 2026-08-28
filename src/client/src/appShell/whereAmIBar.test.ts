import { describe, expect, it } from "vitest";

import { showsWhereAmIBar } from "./whereAmIBar";

describe("the bar that says which machine, project and session you are in", () => {
  /**
   * On a desktop the sidebar carried that identity, and collapsing the sidebar
   * took it away: measured at 1440x900 the shell then said only "Message pi…",
   * the model name, and the panel tabs. Nothing named the machine, the
   * project, the workspace or the session.
   */
  it("appears on a desktop once the panel that carried the identity is collapsed", () => {
    expect(showsWhereAmIBar({ isMobileNavigationLayout: false, navigationCollapsed: true })).toBe(true);
  });

  it("stays out of the way while the panel is showing it", () => {
    expect(showsWhereAmIBar({ isMobileNavigationLayout: false, navigationCollapsed: false })).toBe(false);
  });

  it("is how a phone always says where it is", () => {
    expect(showsWhereAmIBar({ isMobileNavigationLayout: true, navigationCollapsed: false })).toBe(true);
  });
});
