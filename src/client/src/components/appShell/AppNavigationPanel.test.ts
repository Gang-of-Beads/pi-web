// @vitest-environment happy-dom

import { html } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Machine } from "../../api";
import type { MachineStatusSnapshot } from "../../../../shared/machineStatus";
import { machineStatusSnapshot } from "../../machineStatus.testSupport";
import type { MachineSectionContext, NavSectionContext } from "../../plugins/types";
import { workspacesNavSections } from "../../../../../pi-web-plugins/workspaces/browser/pi-web-plugin";
import { ProjectList } from "../../../../../pi-web-plugins/workspaces/browser/ProjectList";
import { WorkspaceList } from "../../../../../pi-web-plugins/workspaces/browser/WorkspaceList";
import { AppNavigationPanel, shouldShowMachinesSection } from "./AppNavigationPanel";
import type { NavigationSection } from "../../appShell/navigationState";

afterEach(() => {
  document.body.replaceChildren();
});

describe("shouldShowMachinesSection", () => {
  it("hides machine navigation only when there is no machine at all", () => {
    expect(shouldShowMachinesSection([])).toBe(false);
  });

  // A single-machine install still needs somewhere to rename the local machine
  // and add a second one; hiding the section left Settings as the only route.
  it("shows machine navigation for a lone local machine", () => {
    expect(shouldShowMachinesSection([machine("local")])).toBe(true);
    expect(shouldShowMachinesSection([machine("local"), machine("remote-a")])).toBe(true);
  });
});

describe("panel body allocation", () => {
  // Regression history: every expanded section used to share the panel height
  // (`flex: 1 1 0px`), so a workspace with 33 sessions showed a single session
  // row beside a one-machine list. The panel now shows one section at a time
  // under a context row, so whichever section is showing owns the body - which
  // supersedes the earlier "pickers are capped, sessions grow" contract.
  const styleText = String(AppNavigationPanel.styles).replace(/\s+/g, " ");

  it("gives the visible section the whole body", () => {
    expect(styleText).toContain("machine-list, project-list, workspace-list, session-list { flex: 1 1 auto;");
    expect(styleText).not.toContain("flex: 1 1 0px");
  });

  it("keeps a collapsed section at heading height", () => {
    expect(styleText).toContain("session-list[collapsed] { flex: 0 0 auto;");
  });
});

describe("machine status wiring", () => {
  it("gives contributed machine sections every machine flag fold and project and workspace sections the selected machine's", async () => {
    const local = machineStatusSnapshot({ machine: { "core:working": true } });
    const remote = machineStatusSnapshot({ machine: { "core:unread": true } });
    const seen: MachineSectionContext[] = [];
    const panel = await mountPanel({ local, "remote-a": remote }, machine("local"), (context) => { seen.push(context); });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.display.tiles).toBe(false);
    expect(seen[0]?.machineFlags).toEqual({ local: { "core:working": true }, "remote-a": { "core:unread": true } });
    expect(section(panel, "project-list", ProjectList).statusSnapshot).toEqual(narrowSnapshot(local));
    expect(section(panel, "workspace-list", WorkspaceList).statusSnapshot).toEqual(narrowSnapshot(local));
  });

  it("reads the local machine's snapshot before a machine has been selected", async () => {
    // `selectedMachine` is undefined until machines load, and can stay undefined
    // if that load fails, while local project rows already render. The app keys
    // snapshots by `selectedMachine?.id ?? LOCAL_MACHINE_ID`, so this panel must
    // resolve the same id instead of blanking every indicator.
    const local = machineStatusSnapshot({ projects: { "project-1": { "core:working": true } } });
    const panel = await mountPanel({ local }, undefined);

    expect(section(panel, "project-list", ProjectList).statusSnapshot).toEqual(narrowSnapshot(local));
    expect(section(panel, "workspace-list", WorkspaceList).statusSnapshot).toEqual(narrowSnapshot(local));
  });

  it("leaves project and workspace sections without a snapshot when the selected machine has none", async () => {
    const panel = await mountPanel({ "remote-a": machineStatusSnapshot() }, machine("local"));

    expect(section(panel, "project-list", ProjectList).statusSnapshot).toBeUndefined();
    expect(section(panel, "workspace-list", WorkspaceList).statusSnapshot).toBeUndefined();
  });
});

/**
 * The compact header chip is the phone's one scope-switching gesture: it must
 * open the context sheet, not a section toggle whose target the fallback order
 * can override. The tools grid follows the sessions section, because its cards
 * act on the workspace that section belongs to - on the pickers they would act
 * on the workspace the user is navigating away from.
 */
describe("compact panel scope and tools", () => {
  it("opens the context sheet from the scope chip", async () => {
    const onOpenContextSheet = vi.fn();
    const panel = await mountPanelWithOptions({}, machine("local"), { onOpenContextSheet });

    const chip = panel.shadowRoot?.querySelector<HTMLButtonElement>("button.compact-scope");
    if (chip === null || chip === undefined) throw new Error("scope chip missing");
    chip.click();

    expect(onOpenContextSheet).toHaveBeenCalledTimes(1);
  });

  it("names machine, project and workspace in the chip's label", async () => {
    const panel = await mountPanelWithOptions({}, machine("local"));

    const chip = panel.shadowRoot?.querySelector<HTMLButtonElement>("button.compact-scope");
    expect(chip?.getAttribute("aria-label")).toBe("Change machine, project or workspace");
  });

  it("shows the tools grid on the sessions section and hides it on the projects picker", async () => {
    const withSessions = await mountPanelWithOptions({}, machine("local"), { sessionsVisible: true });
    expect(withSessions.shadowRoot?.querySelector(".tools-section")).not.toBeNull();

    const withProjects = await mountPanelWithOptions({}, machine("local"), { projectsVisible: true });
    expect(withProjects.shadowRoot?.querySelector(".tools-section")).toBeNull();
  });

  it("sends the desktop context switcher's section request to the shell", async () => {
    const onRequestSection = vi.fn();
    const panel = await mountPanelWithOptions({}, machine("local"), { onRequestSection });

    call(panel, "openSection", ["projects"]);

    expect(onRequestSection).toHaveBeenCalledWith("projects");
  });
});

async function mountPanelWithOptions(
  machineStatusSnapshots: Record<string, MachineStatusSnapshot>,
  selectedMachine: Machine | undefined,
  options: {
    onOpenContextSheet?: () => void;
    onRequestSection?: (section: NavigationSection) => void;
    sessionsVisible?: boolean;
    projectsVisible?: boolean;
  } = {},
): Promise<AppNavigationPanel> {
  const panel = new AppNavigationPanel();
  panel.compact = true;
  panel.machines = [machine("local"), machine("remote-a")];
  if (selectedMachine !== undefined) panel.selectedMachine = selectedMachine;
  panel.machineStatusSnapshots = machineStatusSnapshots;
  wireContributedSections(panel, machineStatusSnapshots, selectedMachine);
  if (options.onOpenContextSheet !== undefined) panel.onOpenContextSheet = options.onOpenContextSheet;
  if (options.onRequestSection !== undefined) panel.onRequestSection = options.onRequestSection;
  panel.toolTabs = [{ id: "core:workspace.files", label: "Files", selected: options.sessionsVisible === true }];
  if (options.sessionsVisible === true) {
    panel.machinesCollapsed = true;
    panel.projectsCollapsed = true;
    panel.workspacesCollapsed = true;
    panel.sessionsCollapsed = false;
  }
  if (options.projectsVisible === true) {
    panel.machinesCollapsed = true;
    panel.projectsCollapsed = false;
    panel.workspacesCollapsed = true;
    panel.sessionsCollapsed = true;
  }
  document.body.append(panel);
  await panel.updateComplete;
  return panel;
}

async function mountPanel(
  machineStatusSnapshots: Record<string, MachineStatusSnapshot>,
  selectedMachine: Machine | undefined,
  onMachineSection?: (context: MachineSectionContext) => void,
): Promise<AppNavigationPanel> {
  const panel = new AppNavigationPanel();
  panel.compact = true;
  panel.machines = [machine("local"), machine("remote-a")];
  if (selectedMachine !== undefined) panel.selectedMachine = selectedMachine;
  panel.machineStatusSnapshots = machineStatusSnapshots;
  wireContributedSections(panel, machineStatusSnapshots, selectedMachine, onMachineSection);
  document.body.append(panel);
  await panel.updateComplete;
  return panel;
}

function narrowSnapshot(snapshot: MachineStatusSnapshot): NavSectionContext["statusSnapshot"] {
  return { projects: snapshot.projects, workspaces: snapshot.workspaces };
}

function wireContributedSections(
  panel: AppNavigationPanel,
  machineStatusSnapshots: Record<string, MachineStatusSnapshot>,
  selectedMachine: Machine | undefined,
  onMachineSection?: (context: MachineSectionContext) => void,
): void {
  panel.machineSections = [{
    id: "machines:machines",
    pluginId: "machines",
    localId: "machines",
    render: (context) => {
      onMachineSection?.(context);
      return html`<div class="contributed-machines"></div>`;
    },
  }];
  panel.machineSectionContext = {
    machines: panel.machines.map((machine) => ({ id: machine.id, name: machine.name, kind: machine.kind, status: "unknown" as const })),
    selectedMachineId: selectedMachine?.id,
    machineFlags: Object.fromEntries(Object.entries(machineStatusSnapshots).map(([id, snapshot]) => [id, snapshot.machine])),
    display: { hidden: false, collapsible: false, collapsed: false, tiles: false, withCreate: false },
    requestUpdate: () => undefined,
    selectMachine: () => undefined,
    toggleCollapsed: () => undefined,
    focusPreviousSection: () => undefined,
    focusNextSection: () => undefined,
    cancelKeyboardNavigation: () => undefined,
  };
  panel.navSections = workspacesNavSections().map((section) => ({
    ...section,
    id: `workspaces:${section.id}`,
    pluginId: "workspaces",
    localId: section.id,
  }));
  const snapshot = machineStatusSnapshots[selectedMachine?.id ?? "local"];
  panel.navSectionContext = {
    projects: [project("project-1")],
    projectsLoad: "loaded",
    workspaces: [workspace("ws-1", "project-1")],
    selectedProjectId: "project-1",
    selectedWorkspaceId: "ws-1",
    machineId: selectedMachine?.id ?? "local",
    deletingWorkspaceIds: [],
    statusSnapshot: snapshot === undefined ? undefined : narrowSnapshot(snapshot),
    labelItems: () => [],
    display: { hidden: false, collapsible: false, collapsed: false, tiles: false, withCreate: false },
    requestUpdate: () => undefined,
    selectProject: () => undefined,
    selectWorkspace: () => undefined,
    retryProjectsLoad: () => undefined,
    toggleCollapsed: () => undefined,
    focusPreviousSection: () => undefined,
    focusNextSection: () => undefined,
    cancelKeyboardNavigation: () => undefined,
  };
}

function section<T>(panel: AppNavigationPanel, selector: string, type: abstract new (...args: never) => T): T {
  const element = panel.shadowRoot?.querySelector(selector);
  if (!(element instanceof type)) throw new Error(`Expected a ${selector} section`);
  return element;
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

function call(panel: AppNavigationPanel, name: string, args: unknown[]): unknown {
  const value: unknown = Reflect.get(panel, name);
  if (typeof value !== "function") throw new Error(`panel has no ${name}`);
  return Reflect.apply(value, panel, args);
}
