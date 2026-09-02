import { describe, expect, it } from "vitest";
import { ancestorsForSession } from "./sessionAncestors.js";
import { machineWorkspaceKey } from "./machineKeys.js";

/**
 * Selecting a session in another project must not leave the goal panel
 * answering for the project you came from.
 *
 * The goals slot is keyed on machine + project + workspace and is handed
 * through only when that key matches the current selection, which is correct as
 * far as it goes. What it cannot defend against is the key failing to move:
 * `selectSession` resolves a session's workspace from the catalogue already in
 * memory, and that holds only the selected project's workspaces. Opening a
 * session that lives elsewhere therefore resolved nothing, the previous
 * `selectedWorkspace` stayed in place, the key still matched, and another
 * project's goal rendered with live Resume and Abandon buttons.
 *
 * The owner reported exactly that twice. The fix fetches the missing project
 * and adopts its workspace, so the key moves.
 */

function catalogue() {
  return {
    workspaces: [{ id: "w-piweb", path: "/p/pi-web", projectId: "proj-piweb" }],
    projects: [{ id: "proj-piweb" }],
  };
}

describe("resolving where a session lives", () => {
  it("finds the workspace when the catalogue holds it", () => {
    expect(ancestorsForSession({ cwd: "/p/pi-web" }, catalogue())?.workspace.id).toBe("w-piweb");
  });

  /** The case that used to strand the selection: another project's session. */
  it("cannot resolve a session whose project is not loaded", () => {
    expect(ancestorsForSession({ cwd: "/p/other" }, catalogue())).toBeUndefined();
  });

  it("cannot resolve a session with no directory at all", () => {
    expect(ancestorsForSession({ cwd: undefined }, catalogue())).toBeUndefined();
  });
});

describe("the key the goal panel is filed under", () => {
  it("changes once the selection moves to the other project", () => {
    const before = machineWorkspaceKey("local", "proj-piweb", "w-piweb");
    const after = machineWorkspaceKey("local", "proj-other", "w-other");

    expect(before).not.toBe(after);
  });

  /**
   * Why the lookup exists rather than a blanked selection: while the fetch is
   * in flight the old key still stands, so the panel must not be asked to
   * render anything new until the selection has actually moved.
   */
  it("is stable for one selection, so a retained slot is only reused for it", () => {
    expect(machineWorkspaceKey("local", "proj-piweb", "w-piweb")).toBe(machineWorkspaceKey("local", "proj-piweb", "w-piweb"));
  });
});
