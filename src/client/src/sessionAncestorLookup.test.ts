import { describe, expect, it, vi } from "vitest";
import { locateSessionWorkspace } from "./sessionAncestorLookup.js";

/**
 * Placing a session that the loaded catalogue cannot place.
 *
 * `selectSession` resolves a session's workspace from the catalogue already in
 * memory, and that catalogue holds only the selected project's workspaces.
 * Opening a session from another project therefore resolved nothing, the
 * previous `selectedWorkspace` stayed put, and every workspace-scoped panel
 * kept answering for the project being left - the goal panel rendered another
 * project's goal with live Resume and Abandon buttons.
 *
 * Rather than blanking the selection, the missing project is fetched: the
 * catalogue is asked for the workspace that owns this cwd. A lookup that finds
 * nothing returns undefined, and the caller must treat that as unknown.
 */

const piweb = { id: "w-piweb", path: "/p/pi-web", projectId: "proj-piweb" };
const other = { id: "w-other", path: "/p/other", projectId: "proj-other" };

function catalogue(map: Record<string, typeof piweb[]>) {
  return {
    projects: () => Promise.resolve(Object.keys(map).map((id) => ({ id }))),
    workspaces: (projectId: string) => Promise.resolve(map[projectId] ?? []),
  };
}

describe("locating the workspace that owns a session", () => {
  it("finds it in a project that was never loaded", async () => {
    const found = await locateSessionWorkspace("/p/other", catalogue({ "proj-piweb": [piweb], "proj-other": [other] }));

    expect(found?.workspace.id).toBe("w-other");
    expect(found?.project.id).toBe("proj-other");
  });

  it("returns undefined when no project owns the directory", async () => {
    expect(await locateSessionWorkspace("/p/nowhere", catalogue({ "proj-piweb": [piweb] }))).toBeUndefined();
  });

  it("stops asking once it has found the owner", async () => {
    const workspaces = vi.fn((projectId: string) => Promise.resolve(projectId === "proj-piweb" ? [piweb] : [other]));

    await locateSessionWorkspace("/p/pi-web", { projects: () => Promise.resolve([{ id: "proj-piweb" }, { id: "proj-other" }]), workspaces });

    expect(workspaces).toHaveBeenCalledTimes(1);
  });

  /** One unreadable project must not hide the answer in the next one. */
  it("keeps looking when a project cannot be read", async () => {
    const found = await locateSessionWorkspace("/p/other", {
      projects: () => Promise.resolve([{ id: "broken" }, { id: "proj-other" }]),
      workspaces: (projectId: string) => projectId === "broken" ? Promise.reject(new Error("nope")) : Promise.resolve([other]),
    });

    expect(found?.workspace.id).toBe("w-other");
  });

  it("gives up quietly when the project list itself fails", async () => {
    const found = await locateSessionWorkspace("/p/other", {
      projects: () => Promise.reject(new Error("offline")),
      workspaces: () => Promise.resolve([]),
    });

    expect(found).toBeUndefined();
  });

  it("does not look up an empty directory", async () => {
    const projects = vi.fn(() => Promise.resolve([{ id: "proj-piweb" }]));

    expect(await locateSessionWorkspace("", { projects, workspaces: () => Promise.resolve([]) })).toBeUndefined();
    expect(projects).not.toHaveBeenCalled();
  });
});
