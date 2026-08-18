import { describe, expect, it } from "vitest";
import { sectionAfterProjectSelection, defaultNavigationSection, expandedNavigationSection, isNavigationSectionCollapsed, toggleCollapsedNavigationSection, toggleNavigationSection } from "./navigationState";

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

  it("uses the mobile accordion state on mobile layouts", () => {
    const state = { selectedProject: {}, selectedWorkspace: {} };

    expect(isNavigationSectionCollapsed("projects", { isMobileLayout: true, expanded: "sessions", state })).toBe(true);
    expect(isNavigationSectionCollapsed("sessions", { isMobileLayout: true, expanded: "sessions", state })).toBe(false);
  });

  it("uses independent collapsed sections on desktop layouts", () => {
    const state = { selectedProject: {}, selectedWorkspace: {} };

    expect(isNavigationSectionCollapsed("projects", { isMobileLayout: false, expanded: "sessions", state })).toBe(false);
    expect(isNavigationSectionCollapsed("projects", { isMobileLayout: false, expanded: "sessions", state, collapsedSections: ["projects"] })).toBe(true);
    expect(isNavigationSectionCollapsed("sessions", { isMobileLayout: false, expanded: "sessions", state, collapsedSections: ["projects"] })).toBe(false);
  });

  it("toggles the effective mobile section, including the implicit default section", () => {
    const state = { selectedProject: undefined, selectedWorkspace: undefined };

    expect(toggleNavigationSection(undefined, "projects", { isMobileLayout: true, state })).toBe("none");
    expect(toggleNavigationSection("none", "projects", { isMobileLayout: true, state })).toBe("projects");
    expect(toggleNavigationSection("projects", "workspaces", { isMobileLayout: true, state })).toBe("workspaces");
  });

  it("does not mutate expanded section on desktop layouts", () => {
    const state = { selectedProject: undefined, selectedWorkspace: undefined };

    expect(toggleNavigationSection("projects", "projects", { isMobileLayout: false, state })).toBe("projects");
  });

  it("toggles desktop sections independently", () => {
    expect(toggleCollapsedNavigationSection([], "projects")).toEqual(["projects"]);
    expect(toggleCollapsedNavigationSection(["machines", "projects"], "projects")).toEqual(["machines"]);
    expect(toggleCollapsedNavigationSection(["sessions"], "machines")).toEqual(["machines", "sessions"]);
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
