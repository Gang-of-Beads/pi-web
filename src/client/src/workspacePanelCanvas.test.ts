import { describe, expect, it } from "vitest";
import { shownWorkspacePanel, workspacePanelHoldsCanvas } from "./workspacePanelCanvas";

interface Page { readonly id: string; readonly fullscreen?: boolean }

const files: Page = { id: "files:files" };
const git: Page = { id: "git:workspace.git", fullscreen: true };

describe("shownWorkspacePanel", () => {
  it("shows the named page", () => {
    expect(shownWorkspacePanel([files, git], "git:workspace.git")).toBe(git);
  });

  it("shows the first page when the named one is not here", () => {
    expect(shownWorkspacePanel([files, git], "gone:panel")).toBe(files);
  });

  it("shows nothing when there are no pages", () => {
    const none: Page[] = [];
    expect(shownWorkspacePanel(none, "files:files")).toBeUndefined();
  });
});

describe("workspacePanelHoldsCanvas", () => {
  const cases: { requested: boolean; shown: Page | undefined; holds: boolean }[] = [
    { requested: true, shown: git, holds: true },
    { requested: false, shown: git, holds: false },
    { requested: true, shown: files, holds: false },
    { requested: true, shown: { id: "x:declined", fullscreen: false }, holds: false },
    { requested: true, shown: undefined, holds: false },
    { requested: false, shown: undefined, holds: false },
  ];

  it.each(cases)("requested $requested, shown $shown -> $holds", ({ requested, shown, holds }) => {
    expect(workspacePanelHoldsCanvas(requested, shown)).toBe(holds);
  });

  it("does not let a page that never declared it inherit a request made for another", () => {
    const panels = [files, git];
    expect(workspacePanelHoldsCanvas(true, shownWorkspacePanel(panels, "git:workspace.git"))).toBe(true);
    expect(workspacePanelHoldsCanvas(true, shownWorkspacePanel(panels, "files:files"))).toBe(false);
    expect(workspacePanelHoldsCanvas(true, shownWorkspacePanel([files], "git:workspace.git"))).toBe(false);
  });
});
