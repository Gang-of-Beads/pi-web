// @vitest-environment happy-dom

import { html } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import { initialAppState } from "../appState";
import type { QualifiedContributionId, QualifiedWorkspacePanelContribution, WorkspaceHost } from "../plugins/types";
import type { AppRoute, ParsedAppRoute } from "../route";
import { PiWebApp } from "./PiWebApp";

const project = { id: "project-1", name: "Project", path: "/repo", createdAt: "now" };
const workspace = { id: "workspace-1", projectId: project.id, path: "/repo", label: "main", isMain: true, effectiveConfig: {} };
const terminalRoute: AppRoute = {
  machineId: undefined,
  projectId: project.id,
  workspaceId: workspace.id,
  sessionId: undefined,
  tool: "core:workspace.terminal",
  view: "core:workspace.terminal",
};

afterEach(() => {
  window.history.replaceState({}, "", "/");
  document.body.replaceChildren();
});

describe("PiWebApp workspace expanded route", () => {
  it("reads and writes the workspace-scoped expanded value with the selected terminal", () => {
    window.history.replaceState({}, "", `/?project=${project.id}&workspace=${workspace.id}&core.workspace.terminal--terminal=terminal-1&core.workspace--expanded=1`);
    const app = appAt("core:workspace.terminal", [page("core:workspace.terminal", true)]);
    const parsed: ParsedAppRoute = { ...terminalRoute };

    expect(callAppMethod(app, "readWorkspaceRouteSurface", parsed)).toEqual({
      selectedFilePath: undefined,
      selectedTerminalId: "terminal-1",
      workspaceExpanded: true,
    });

    Reflect.set(app, "workspacePanelFullscreen", true);
    callAppMethod(app, "syncWorkspaceRouteSurfaceToUrl");
    const params = new URL(window.location.href).searchParams;
    expect(params.get("core.workspace.terminal--terminal")).toBe("terminal-1");
    expect(params.get("core.workspace--expanded")).toBe("1");
  });

  it("keeps host state and route state in sync for a page that declared the canvas", () => {
    window.history.replaceState({}, "", `/?project=${project.id}&workspace=${workspace.id}&tool=core%3Aworkspace.terminal&view=core%3Aworkspace.terminal`);
    const app = appAt("core:workspace.terminal", [page("core:workspace.terminal", true)]);
    const host = workspaceHost(app);

    expect(host.workspacePanelFullscreen()).toBe(false);
    host.setWorkspacePanelFullscreen(true);

    expect(host.workspacePanelFullscreen()).toBe(true);
    expect(new URL(window.location.href).searchParams.get("core.workspace--expanded")).toBe("1");

    host.setWorkspacePanelFullscreen(false);
    expect(new URL(window.location.href).searchParams.get("core.workspace--expanded")).toBeNull();

    host.setWorkspacePanelFullscreen(true);
    callAppMethod(app, "selectMainView", "chat");
    expect(host.workspacePanelFullscreen()).toBe(false);
    expect(new URL(window.location.href).searchParams.get("core.workspace--expanded")).toBeNull();
  });

  it("ignores the ask from a page that did not declare the canvas", () => {
    window.history.replaceState({}, "", `/?project=${project.id}&workspace=${workspace.id}&tool=files%3Afiles&view=files%3Afiles`);
    const app = appAt("files:files", [page("files:files", false), page("git:workspace.git", true)]);
    const host = workspaceHost(app);

    host.setWorkspacePanelFullscreen(true);
    const requested: unknown = Reflect.get(app, "workspacePanelFullscreen");

    expect({
      holds: host.workspacePanelFullscreen(),
      requested,
      expanded: new URL(window.location.href).searchParams.get("core.workspace--expanded"),
    }).toEqual({ holds: false, requested: false, expanded: null });
  });

  it("never puts a page that did not declare it on the canvas from a link, and drops the link's word", () => {
    window.history.replaceState({}, "", `/?project=${project.id}&workspace=${workspace.id}&tool=files%3Afiles&view=files%3Afiles&core.workspace--expanded=1`);
    const app = appAt("files:files", [page("files:files", false)]);
    const filesRoute: AppRoute = { ...terminalRoute, tool: "files:files", view: "files:files" };

    callAppMethod(app, "restoreWorkspaceExpandedRoute", filesRoute, { workspaceExpanded: true }, "files:files");
    callAppMethod(app, "syncWorkspaceRouteSurfaceToUrl");

    expect({
      holds: workspaceHost(app).workspacePanelFullscreen(),
      expanded: new URL(window.location.href).searchParams.get("core.workspace--expanded"),
    }).toEqual({ holds: false, expanded: null });
  });

  it("gives the canvas back when the reader opens another page, and keeps it on the same one", () => {
    window.history.replaceState({}, "", `/?project=${project.id}&workspace=${workspace.id}&tool=git%3Aworkspace.git&view=git%3Aworkspace.git`);
    const app = appAt("git:workspace.git", [page("files:files", true), page("git:workspace.git", true)]);
    const host = workspaceHost(app);
    host.setWorkspacePanelFullscreen(true);

    callAppMethod(app, "openWorkspaceTool", "git:workspace.git");
    const sameTool = host.workspacePanelFullscreen();
    callAppMethod(app, "openWorkspaceTool", "files:files");
    const requested: unknown = Reflect.get(app, "workspacePanelFullscreen");

    expect({ sameTool, otherTool: host.workspacePanelFullscreen(), requested })
      .toEqual({ sameTool: true, otherTool: false, requested: false });
  });

  it("does not let a page shown in place of a missing one inherit the canvas", () => {
    const app = appAt("git:workspace.git", [page("files:files", false)]);
    Reflect.set(app, "workspacePanelFullscreen", true);

    expect(workspaceHost(app).workspacePanelFullscreen()).toBe(false);
  });

  it("says the canvas is available only in the desktop side-by-side layout", () => {
    const app = appAt("git:workspace.git", [page("git:workspace.git", true)]);
    const host = workspaceHost(app);

    setWindowShowsCanvas(app, true);
    const wide = host.workspacePanelFullscreenAvailable?.();
    setWindowShowsCanvas(app, false);
    const narrow = host.workspacePanelFullscreenAvailable?.();

    expect({ wide, narrow }).toEqual({ wide: true, narrow: false });
  });

  it("holds the canvas only while the window can show it, and returns to it when the window widens", () => {
    const app = appAt("git:workspace.git", [page("git:workspace.git", true)]);
    const host = workspaceHost(app);
    host.setWorkspacePanelFullscreen(true);

    setWindowShowsCanvas(app, false);
    const narrowed = host.workspacePanelFullscreen();
    setWindowShowsCanvas(app, true);

    expect({ narrowed, widened: host.workspacePanelFullscreen() }).toEqual({ narrowed: false, widened: true });
  });

  it("never hides the app bar behind a workspace panel the reader folded away, and returns when it opens", () => {
    const app = appAt("git:workspace.git", [page("git:workspace.git", true)]);
    const fold: unknown = Reflect.get(app, "panelCollapse");
    if (typeof fold !== "object" || fold === null) throw new Error("PiWebApp has no panel fold");
    Reflect.set(fold, "workspacePanelCollapsed", true);
    callAppMethod(app, "restoreWorkspaceExpandedRoute", { ...terminalRoute, tool: "git:workspace.git", view: "git:workspace.git" }, { workspaceExpanded: true }, "git:workspace.git");
    const host = workspaceHost(app);
    const folded = host.workspacePanelFullscreen();
    Reflect.set(fold, "workspacePanelCollapsed", false);

    expect({ folded, opened: host.workspacePanelFullscreen() }).toEqual({ folded: false, opened: true });
  });

  it("does not let a declared page standing in for a missing one take a request made for that one", () => {
    const app = appAt("gone:panel", [page("git:workspace.git", true)]);
    Reflect.set(app, "workspacePanelFullscreen", true);
    const host = workspaceHost(app);
    const inherited = host.workspacePanelFullscreen();
    host.setWorkspacePanelFullscreen(false);
    host.setWorkspacePanelFullscreen(true);
    const requested: unknown = Reflect.get(app, "workspacePanelFullscreen");

    expect({ inherited, requested }).toEqual({ inherited: false, requested: false });
  });

  it("restores expansion only for a matching active workspace-tool route", () => {
    const app = appAt("core:workspace.terminal", [page("core:workspace.terminal", true)]);

    callAppMethod(app, "restoreWorkspaceExpandedRoute", terminalRoute, { workspaceExpanded: true }, "core:workspace.terminal");
    expect(Reflect.get(app, "workspacePanelFullscreen")).toBe(true);

    callAppMethod(app, "restoreWorkspaceExpandedRoute", { ...terminalRoute, workspaceId: "other" }, { workspaceExpanded: true }, "core:workspace.terminal");
    expect(Reflect.get(app, "workspacePanelFullscreen")).toBe(false);

    callAppMethod(app, "restoreWorkspaceExpandedRoute", terminalRoute, { workspaceExpanded: true }, "core:workspace.files");
    expect(Reflect.get(app, "workspacePanelFullscreen")).toBe(false);

    const filesRoute: AppRoute = { ...terminalRoute, tool: "core:workspace.files", view: "core:workspace.files" };
    callAppMethod(app, "restoreWorkspaceExpandedRoute", filesRoute, { workspaceExpanded: true }, "core:workspace.files");
    expect(Reflect.get(app, "workspacePanelFullscreen")).toBe(true);
  });
});

function page(id: QualifiedContributionId, fullscreen: boolean): QualifiedWorkspacePanelContribution {
  const [pluginId = "", localId = ""] = id.split(":");
  return { id, pluginId, localId, title: localId, fullscreen, render: () => html`` };
}

function appAt(tool: QualifiedContributionId, panels: QualifiedWorkspacePanelContribution[]): PiWebApp {
  const app = new PiWebApp();
  Reflect.set(app, "state", {
    ...initialAppState(),
    selectedProject: project,
    selectedWorkspace: workspace,
    projects: [project],
    workspaces: [workspace],
    selectedTerminalId: "terminal-1",
    workspaceTool: tool,
    mainView: tool,
  });
  Reflect.set(app, "visibleWorkspacePanels", () => panels);
  setWindowShowsCanvas(app, true);
  return app;
}

function setWindowShowsCanvas(app: PiWebApp, wide: boolean): void {
  const shell: unknown = Reflect.get(app, "appShell");
  if (typeof shell !== "object" || shell === null) throw new Error("PiWebApp has no app shell");
  Reflect.set(shell, "isDesktopSideBySideLayout", wide);
}

function workspaceHost(app: PiWebApp): WorkspaceHost {
  const host = callAppMethod(app, "createWorkspaceHost");
  if (!isWorkspaceHost(host)) throw new Error("PiWebApp did not create a workspace host");
  return host;
}

function isWorkspaceHost(value: unknown): value is WorkspaceHost {
  return typeof value === "object" && value !== null && "requestRender" in value;
}

function callAppMethod(app: PiWebApp, name: string, ...args: unknown[]): unknown {
  const method: unknown = Reflect.get(app, name);
  if (typeof method !== "function") throw new Error(`PiWebApp.${name} is not callable`);
  return Reflect.apply(method, app, args);
}
