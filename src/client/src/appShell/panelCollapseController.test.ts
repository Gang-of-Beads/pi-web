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

  it("shows the panel the reader asked for even before a workspace exists", () => {
    // Otherwise the edge control is a visible button that does nothing, which
    // is how the tools read as missing on a desktop with no project chosen.
    expect(workspacePanelTakesSpace(false, false, true)).toBe(true);
  });

  it("still honours a collapse that came after the request", () => {
    expect(workspacePanelTakesSpace(true, false, true)).toBe(false);
  });
});
