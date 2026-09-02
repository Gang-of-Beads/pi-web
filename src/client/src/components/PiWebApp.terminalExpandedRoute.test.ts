// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { initialAppState } from "../appState";
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

describe("PiWebApp terminal expanded route", () => {
  it("reads and writes the namespaced expanded value with the selected terminal", () => {
    window.history.replaceState({}, "", `/?project=${project.id}&workspace=${workspace.id}&core.workspace.terminal--terminal=terminal-1&core.workspace.terminal--expanded=1`);
    const app = appAtTerminal();
    const parsed: ParsedAppRoute = { ...terminalRoute };

    expect(callAppMethod(app, "readWorkspaceRouteSurface", parsed)).toEqual({
      selectedFilePath: undefined,
      selectedTerminalId: "terminal-1",
      terminalExpanded: true,
    });

    Reflect.set(app, "workspacePanelFullscreen", true);
    callAppMethod(app, "syncWorkspaceRouteSurfaceToUrl");
    const params = new URL(window.location.href).searchParams;
    expect(params.get("core.workspace.terminal--terminal")).toBe("terminal-1");
    expect(params.get("core.workspace.terminal--expanded")).toBe("1");
  });

  it("restores expansion only for the matching active Terminal workspace route", () => {
    const app = appAtTerminal();

    callAppMethod(app, "restoreTerminalExpandedRoute", terminalRoute, { terminalExpanded: true }, "core:workspace.terminal");
    expect(Reflect.get(app, "workspacePanelFullscreen")).toBe(true);

    callAppMethod(app, "restoreTerminalExpandedRoute", { ...terminalRoute, workspaceId: "other" }, { terminalExpanded: true }, "core:workspace.terminal");
    expect(Reflect.get(app, "workspacePanelFullscreen")).toBe(false);

    callAppMethod(app, "restoreTerminalExpandedRoute", terminalRoute, { terminalExpanded: true }, "core:workspace.files");
    expect(Reflect.get(app, "workspacePanelFullscreen")).toBe(false);
  });
});

function appAtTerminal(): PiWebApp {
  const app = new PiWebApp();
  Reflect.set(app, "state", {
    ...initialAppState(),
    selectedProject: project,
    selectedWorkspace: workspace,
    projects: [project],
    workspaces: [workspace],
    selectedTerminalId: "terminal-1",
    workspaceTool: "core:workspace.terminal",
    mainView: "core:workspace.terminal",
  });
  return app;
}

function callAppMethod(app: PiWebApp, name: string, ...args: unknown[]): unknown {
  const method: unknown = Reflect.get(app, name);
  if (typeof method !== "function") throw new Error(`PiWebApp.${name} is not callable`);
  return Reflect.apply(method, app, args);
}
