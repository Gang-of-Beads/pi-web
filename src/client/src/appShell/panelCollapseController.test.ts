import { describe, expect, it } from "vitest";
import { panelToggleHiddenState, workspacePanelTakesSpace } from "./panelCollapseController";

/**
 * The workspace column is minmax(360px, 42vw) — 538px on a 1280px desktop,
 * wider than the chat beside it. An empty panel must not hold that space.
 */
describe("workspacePanelTakesSpace", () => {
  it("keeps the column when there is a workspace to show", () => {
    expect(workspacePanelTakesSpace(false, true)).toBe(true);
  });

  it("gives the column up when there is nothing to show", () => {
    expect(workspacePanelTakesSpace(false, false)).toBe(false);
  });

  it("respects an explicit collapse even with a workspace open", () => {
    // The user's own choice is not second-guessed.
    expect(workspacePanelTakesSpace(true, true)).toBe(false);
  });

  it("stays collapsed when both reasons apply", () => {
    expect(workspacePanelTakesSpace(true, false)).toBe(false);
  });
});

/**
 * The phone hides the panel toggle exactly when the panel is the whole view.
 * A tool view stacked above the panel is not that state: there the toggle is
 * the labeled exit, which is why the old "no session" predicate hid it in a
 * tool view and left the surface with no way out.
 */
describe("panelToggleHiddenState", () => {
  it("hides the toggle while the panel is the whole view", () => {
    expect(panelToggleHiddenState({ mobileLayout: true, displayView: "navigation" })).toBe(true);
  });

  it("shows the toggle in a tool view even without a session", () => {
    expect(panelToggleHiddenState({ mobileLayout: true, displayView: "files:files" })).toBe(false);
  });

  it("shows the toggle on the desktop layout", () => {
    expect(panelToggleHiddenState({ mobileLayout: false, displayView: "navigation" })).toBe(false);
  });
});
