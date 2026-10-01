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

    expect(found).toEqual({ kind: "found", workspace: other, project: { id: "proj-other" }, workspaces: [other] });
  });

  it("is outside every open project when every project answered without the directory, or there are none (B49)", async () => {
    expect([
      await locateSessionWorkspace("/p/nowhere", catalogue({ "proj-piweb": [piweb] })),
      await locateSessionWorkspace("/p/nowhere", catalogue({})),
    ]).toEqual([{ kind: "outside" }, { kind: "outside" }]);
  });

  it("finds the deepest workspace a subdirectory lies under, once every project answered", async () => {
    const root = { id: "w-root", path: "/p", projectId: "proj-root" };
    const found = await locateSessionWorkspace("/p/other/src", catalogue({ "proj-root": [root], "proj-other": [other] }));

    expect(found).toEqual({ kind: "found", workspace: other, project: { id: "proj-other" }, workspaces: [other] });
  });

  /**
   * B48: a project's workspaces are read until they answer, so a project that
   * never answers must not stand in front of the one that owns the directory.
   */
  it("asks every project at once, so one that never answers does not hide the owner", async () => {
    const workspaces = vi.fn((projectId: string) => projectId === "silent" ? new Promise<typeof piweb[]>(() => undefined) : Promise.resolve([other]));

    const found = await locateSessionWorkspace("/p/other", { projects: () => Promise.resolve([{ id: "silent" }, { id: "proj-other" }]), workspaces });

    expect(found).toEqual({ kind: "found", workspace: other, project: { id: "proj-other" }, workspaces: [other] });
    expect(workspaces).toHaveBeenCalledTimes(2);
  });

  it("is unknown, not outside, while a project has not answered", async () => {
    const found = await locateSessionWorkspace("/p/nowhere", {
      projects: () => Promise.resolve([{ id: "a" }, { id: "b" }]),
      workspaces: (projectId: string) => projectId === "a" ? Promise.resolve(undefined) : Promise.resolve([other]),
    });

    expect(found).toEqual({ kind: "unknown" });
  });

  /** One unreadable project must not hide the answer in the next one. */
  it("keeps looking when a project cannot be read", async () => {
    const found = await locateSessionWorkspace("/p/other", {
      projects: () => Promise.resolve([{ id: "broken" }, { id: "proj-other" }]),
      workspaces: (projectId: string) => projectId === "broken" ? Promise.reject(new Error("nope")) : Promise.resolve([other]),
    });
    const nowhere = await locateSessionWorkspace("/p/nowhere", {
      projects: () => Promise.resolve([{ id: "broken" }, { id: "proj-other" }]),
      workspaces: (projectId: string) => projectId === "broken" ? Promise.reject(new Error("nope")) : Promise.resolve([other]),
    });

    expect({ found: found.kind, nowhere }).toEqual({ found: "found", nowhere: { kind: "unknown" } });
  });

  it("gives up quietly when the project list itself fails", async () => {
    const found = await locateSessionWorkspace("/p/other", {
      projects: () => Promise.reject(new Error("offline")),
      workspaces: () => Promise.resolve([]),
    });

    expect(found).toEqual({ kind: "unknown" });
  });

  it("does not look up an empty directory", async () => {
    const projects = vi.fn(() => Promise.resolve([{ id: "proj-piweb" }]));

    expect(await locateSessionWorkspace("", { projects, workspaces: () => Promise.resolve([]) })).toEqual({ kind: "unknown" });
    expect(projects).not.toHaveBeenCalled();
  });
});
