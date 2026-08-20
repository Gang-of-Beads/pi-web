import { describe, expect, it } from "vitest";
import { sectionAfterProjectSelection, defaultNavigationSection, expandedNavigationSection, isNavigationSectionCollapsed, toggleNavigationSection } from "./navigationState";

describe("navigationState", () => {
  it("defaults to the first incomplete selection section", () => {
    expect(defaultNavigationSection({ selectedProject: undefined, selectedWorkspace: undefined })).toBe("projects");
    expect(defaultNavigationSection({ selectedProject: {}, selectedWorkspace: undefined })).toBe("workspaces");
    expect(defaultNavigationSection({ selectedProject: {}, selectedWorkspace: {} })).toBe("sessions");
  });

  it("expands the default section until the user explicitly toggles a section", () => {
    const state = { selectedProject: {}, selectedWorkspace: undefined };

    expect(expandedNavigationSection(undefined, state)).toBe("workspaces");
    expect(expandedNavigationSection("sessions", state)).toBe("sessions");
    expect(expandedNavigationSection("none", state)).toBeUndefined();
  });

  // One model on every width now: the context row names machine, project and
  // workspace, so a picker is only on screen while it is being used. Desktop's
  // second model - independently collapsed sections - is gone with the stack it
  // described.
  it("treats every section but the expanded one as collapsed", () => {
    const state = { selectedProject: {}, selectedWorkspace: {} };

    expect(isNavigationSectionCollapsed("projects", { expanded: "sessions", state })).toBe(true);
    expect(isNavigationSectionCollapsed("sessions", { expanded: "sessions", state })).toBe(false);
  });

  it("collapses everything when the user closes the open section", () => {
    const state = { selectedProject: {}, selectedWorkspace: {} };

    expect(isNavigationSectionCollapsed("sessions", { expanded: "none", state })).toBe(true);
  });

  it("toggles the effective section, including the implicit default one", () => {
    const state = { selectedProject: undefined, selectedWorkspace: undefined };

    expect(toggleNavigationSection(undefined, "projects", { state })).toBe("none");
    expect(toggleNavigationSection("none", "projects", { state })).toBe("projects");
    expect(toggleNavigationSection("projects", "workspaces", { state })).toBe("workspaces");
  });

});

describe("defaultNavigationSection", () => {
  it("opens sessions directly once a workspace is selected", () => {
    expect(defaultNavigationSection({ selectedProject: {}, selectedWorkspace: {} })).toBe("sessions");
  });

  it("still asks for a project when nothing is selected", () => {
    expect(defaultNavigationSection({ selectedProject: undefined, selectedWorkspace: undefined })).toBe("projects");
  });

  it("asks for a workspace when only the project is known", () => {
    expect(defaultNavigationSection({ selectedProject: {}, selectedWorkspace: undefined })).toBe("workspaces");
  });

  // A restored deep link can name a workspace before its project row loads;
  // the working surface is still the right place to land.
  it("prefers sessions when a workspace is known without its project", () => {
    expect(defaultNavigationSection({ selectedProject: undefined, selectedWorkspace: {} })).toBe("sessions");
  });
});

describe("skipping a step that offers no choice", () => {
  // A workspace is a git worktree, so the layer earns its place when a project
  // has several. With exactly one it is a step that shows a list of one and
  // asks the user to pick the only option -- and the app has already selected
  // it by then, so the tap achieves nothing but a second screen.
  it("advances past workspaces to sessions when the project has only one", () => {
    expect(sectionAfterProjectSelection({ workspaceCount: 1 })).toBe("sessions");
  });

  it("stops at workspaces when there is a genuine choice", () => {
    expect(sectionAfterProjectSelection({ workspaceCount: 3 })).toBe("workspaces");
  });

  // Nothing is known yet at the moment of the tap, so the honest destination is
  // the list that is about to be filled rather than a guess at its contents.
  it("stops at workspaces when the count is not yet known", () => {
    expect(sectionAfterProjectSelection({ workspaceCount: undefined })).toBe("workspaces");
  });
});
