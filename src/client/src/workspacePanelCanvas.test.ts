import { describe, expect, it } from "vitest";
import { shownWorkspacePanel, workspacePanelHoldsCanvas, workspacePanelMayHoldCanvas } from "./workspacePanelCanvas";

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

describe("workspacePanelMayHoldCanvas", () => {
  const cases: { tool: string; shown: Page | undefined; may: boolean }[] = [
    { tool: "git:workspace.git", shown: git, may: true },
    { tool: "files:files", shown: files, may: false },
    { tool: "x:declined", shown: { id: "x:declined", fullscreen: false }, may: false },
    { tool: "gone:panel", shown: git, may: false },
    { tool: "git:workspace.git", shown: undefined, may: false },
  ];

  it.each(cases)("tool $tool, shown $shown -> $may", ({ tool, shown, may }) => {
    expect(workspacePanelMayHoldCanvas(tool, shown)).toBe(may);
  });
});

describe("workspacePanelHoldsCanvas", () => {
  const cases: { requested: boolean; windowShowsCanvas: boolean; panelOnScreen: boolean; tool: string; shown: Page | undefined; holds: boolean }[] = [
    { requested: true, windowShowsCanvas: true, panelOnScreen: true, tool: git.id, shown: git, holds: true },
    { requested: false, windowShowsCanvas: true, panelOnScreen: true, tool: git.id, shown: git, holds: false },
    { requested: true, windowShowsCanvas: false, panelOnScreen: true, tool: git.id, shown: git, holds: false },
    { requested: true, windowShowsCanvas: true, panelOnScreen: false, tool: git.id, shown: git, holds: false },
    { requested: true, windowShowsCanvas: true, panelOnScreen: true, tool: files.id, shown: files, holds: false },
    { requested: true, windowShowsCanvas: true, panelOnScreen: true, tool: "gone:panel", shown: git, holds: false },
    { requested: true, windowShowsCanvas: true, panelOnScreen: true, tool: git.id, shown: undefined, holds: false },
  ];

  it.each(cases)("requested $requested, window $windowShowsCanvas, panel $panelOnScreen, tool $tool, shown $shown -> $holds", ({ holds, ...facts }) => {
    expect(workspacePanelHoldsCanvas(facts)).toBe(holds);
  });

  it("does not let a page that never declared it, or a page standing in for a missing one, inherit a request", () => {
    const panels = [git, files];
    const holdsFor = (tool: string) => workspacePanelHoldsCanvas({ requested: true, windowShowsCanvas: true, panelOnScreen: true, tool, shown: shownWorkspacePanel(panels, tool) });
    expect({ git: holdsFor(git.id), files: holdsFor(files.id), missing: holdsFor("gone:panel") }).toEqual({ git: true, files: false, missing: false });
  });
});
