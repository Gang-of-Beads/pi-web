import { describe, expect, it } from "vitest";
import { workspacePanelTakesSpace } from "./panelCollapseController";

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
