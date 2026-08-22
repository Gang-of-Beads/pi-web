import { describe, expect, it } from "vitest";
import { shouldShowQuickActions } from "./quickActionVisibility";

/**
 * The row costs 65px of a 839px screen and sits under two other bars, pushing
 * the list to y=199. It should appear only when it is the way forward.
 */
describe("shouldShowQuickActions", () => {
  it("shows on an empty app, where adding a project is the only next step", () => {
    expect(shouldShowQuickActions({ projectCount: 0, hasSelectedProject: false, canStartSession: false, visibleSection: "projects" })).toBe(true);
  });

  it("hides on the sessions list, which has its own start affordance", () => {
    expect(shouldShowQuickActions({ projectCount: 3, hasSelectedProject: true, canStartSession: true, visibleSection: "sessions" })).toBe(false);
  });

  it("shows elsewhere when a session can actually be started", () => {
    expect(shouldShowQuickActions({ projectCount: 3, hasSelectedProject: true, canStartSession: true, visibleSection: "workspaces" })).toBe(true);
  });

  it("hides when its buttons would do nothing", () => {
    expect(shouldShowQuickActions({ projectCount: 3, hasSelectedProject: true, canStartSession: false, visibleSection: "projects" })).toBe(false);
  });

  it("shows on a machine whose projects exist but none is chosen", () => {
    // Switching to a remote machine leaves no workspace selected, so
    // canStartSession is false - and the row, the only route to "Add project"
    // on a phone, used to disappear exactly there. Adding a project is what
    // someone does on a machine they have just reached; requiring a startable
    // session first made it a circle.
    expect(shouldShowQuickActions({ projectCount: 2, hasSelectedProject: false, canStartSession: false, visibleSection: "projects" })).toBe(true);
  });

  it("still shows with no projects even on the sessions section", () => {
    // An empty app has no sessions to start from, so the row must not vanish.
    expect(shouldShowQuickActions({ projectCount: 0, hasSelectedProject: false, canStartSession: false, visibleSection: "sessions" })).toBe(true);
  });
});
