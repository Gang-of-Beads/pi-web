// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Machine } from "../../api";
import type { NavSectionContext, QualifiedNavSectionContribution } from "../../plugins/types";
import { MachineList } from "../MachineList";
import { workspacesNavSections } from "../../../../../pi-web-plugins/workspaces/browser/pi-web-plugin";
import { ProjectList } from "../../../../../pi-web-plugins/workspaces/browser/ProjectList";
import { WorkspaceList } from "../../../../../pi-web-plugins/workspaces/browser/WorkspaceList";
import { ContextSwitcherSheet } from "./ContextSwitcherSheet";

afterEach(() => {
  document.body.replaceChildren();
});

/**
 * The sheet is the phone's context breadcrumb: every level on one surface, the
 * current one marked, a pick hands the decision to the shell's ladder and the
 * shell closes the sheet. The lists are the workspaces plugin's contributed
 * sections — the sheet slots them and keeps the headings; it must not grow a
 * second way to select.
 */
describe("context-switcher-sheet", () => {
  it("marks the current machine, project and workspace", async () => {
    const sheet = await mount();

    const machines = deep(sheet, "machine-list", MachineList);
    expect(machines?.selected?.id).toBe("local");
    const projects = deep(sheet, "project-list", ProjectList);
    if (projects === undefined) throw new Error("project list missing");
    expect(projects.selected?.id).toBe("project-1");
    const workspaces = deep(sheet, "workspace-list", WorkspaceList);
    if (workspaces === undefined) throw new Error("workspace list missing");
    expect(workspaces.selected?.id).toBe("ws-1");
  });

  it("hides the machine group for a single-machine install", async () => {
    const sheet = await mount({ machines: [machine("local")] });

    expect(deep(sheet, "machine-list", MachineList)).toBeUndefined();
  });

  it("hands a project pick to the shell without closing itself", async () => {
    const onSelectProject = vi.fn();
    const onClose = vi.fn();
    const sheet = await mount({ onSelectProject, onClose });

    const projects = deep(sheet, "project-list", ProjectList);
    if (projects === undefined) throw new Error("project list missing");
    const row = projects.shadowRoot?.querySelector<HTMLButtonElement>("button.action-main");
    if (row === null || row === undefined) throw new Error("project row missing");
    row.click();

    expect(onSelectProject).toHaveBeenCalledWith("project-1");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("offers Add project in the projects group", async () => {
    const onAddProject = vi.fn();
    const sheet = await mount({ addProject: onAddProject });

    const projects = deep(sheet, "project-list", ProjectList);
    if (projects === undefined) throw new Error("project list missing");
    const labels = Array.from(projects.shadowRoot?.querySelectorAll("button") ?? []).map((button) => button.textContent.trim());
    expect(labels.some((text) => text.includes("Add"))).toBe(true);
  });
});

async function mount(options: {
  machines?: Machine[];
  onSelectProject?: (projectId: string) => void;
  addProject?: () => void;
  onClose?: () => void;
} = {}): Promise<ContextSwitcherSheet> {
  const machines = options.machines ?? [machine("local"), machine("remote")];
  const sheet = new ContextSwitcherSheet();
  sheet.machines = machines;
  if (machines[0] !== undefined) sheet.selectedMachine = machines[0];
  sheet.navSections = qualifiedSections();
  sheet.navSectionContext = navContext(options);
  if (options.onClose !== undefined) sheet.onClose = options.onClose;
  document.body.append(sheet);
  await sheet.updateComplete;
  return sheet;
}

function qualifiedSections(): QualifiedNavSectionContribution[] {
  return workspacesNavSections().map((section) => ({
    ...section,
    id: `workspaces:${section.id}`,
    pluginId: "workspaces",
    localId: section.id,
  }));
}

function navContext(options: {
  onSelectProject?: (projectId: string) => void;
  addProject?: () => void;
}): NavSectionContext {
  return {
    projects: [project("project-1"), project("project-2")],
    projectsLoad: "loaded",
    workspaces: [workspace("ws-1", "project-1"), workspace("ws-2", "project-1")],
    selectedProjectId: "project-1",
    selectedWorkspaceId: "ws-1",
    machineId: "local",
    deletingWorkspaceIds: [],
    statusSnapshot: undefined,
    labelItems: () => [],
    display: { hidden: false, collapsible: false, collapsed: false, tiles: false },
    requestUpdate: () => undefined,
    selectProject: (projectId) => { options.onSelectProject?.(projectId); },
    selectWorkspace: () => undefined,
    retryProjectsLoad: () => undefined,
    toggleCollapsed: () => undefined,
    focusPreviousSection: () => undefined,
    focusNextSection: () => undefined,
    cancelKeyboardNavigation: () => undefined,
    ...(options.addProject === undefined ? {} : { addProject: options.addProject }),
  };
}

function deep<T extends HTMLElement>(sheet: ContextSwitcherSheet, selector: string, type: abstract new (...args: never) => T): T | undefined {
  // The lists render inside the sheet's shadow (as modal-surface's slotted
  // light children), so the shadow root is the first place to look.
  const root = sheet.shadowRoot;
  if (root === null) return undefined;
  const hit = root.querySelector(selector);
  if (hit instanceof type) return hit;
  return undefined;
}

function machine(id: string): Machine {
  return {
    id,
    name: id,
    kind: id === "local" ? "local" : "remote",
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
  };
}

function project(id: string): NavSectionContext["projects"][number] {
  return { id, name: id, path: `/repo/${id}` };
}

function workspace(id: string, projectId: string): NavSectionContext["workspaces"][number] {
  return { id, projectId, path: `/repo/${id}`, label: id, isMain: true, effectiveConfig: {} };
}
