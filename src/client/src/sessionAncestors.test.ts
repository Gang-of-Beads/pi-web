import { describe, expect, it } from "vitest";
import { ancestorsForSession } from "./sessionAncestors";

const workspaces = [
  { id: "w-pi", projectId: "p-pi", path: "/home/me/pi-web" },
  { id: "w-be", projectId: "p-be", path: "/home/me/be-dev" },
];
const projects = [{ id: "p-pi", name: "pi-web" }, { id: "p-be", name: "be-dev" }];

describe("what a chosen session says about where you are", () => {
  /**
   * Picking a session from the switcher set the session and nothing else, so
   * the project and workspace kept pointing at wherever you were before. The
   * conversation was the new one while the Sessions list beside it still
   * belonged to the old workspace.
   *
   * The session's directory says which workspace it belongs to; the workspace
   * says which project.
   */
  it("follows the session to its own workspace and project", () => {
    const moved = ancestorsForSession({ cwd: "/home/me/be-dev" }, { workspaces, projects });

    expect(moved).toEqual({ workspace: workspaces[1], project: projects[1] });
  });

  it("stays put when the session is already where you are", () => {
    expect(ancestorsForSession({ cwd: "/home/me/pi-web" }, { workspaces, projects })).toEqual({
      workspace: workspaces[0],
      project: projects[0],
    });
  });

  /**
   * A directory nobody has catalogued is not evidence that the current
   * selection is wrong, so nothing moves.
   */
  it("leaves the selection alone when the directory is unknown", () => {
    expect(ancestorsForSession({ cwd: "/tmp/elsewhere" }, { workspaces, projects })).toBeUndefined();
  });

  it("leaves the selection alone when the workspaces have not arrived", () => {
    expect(ancestorsForSession({ cwd: "/home/me/be-dev" }, { workspaces: [], projects })).toBeUndefined();
  });
});
