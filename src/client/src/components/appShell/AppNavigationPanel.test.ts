// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { Machine, Project, Workspace } from "../../api";
import type { MachineStatusSnapshot } from "../../../../shared/machineStatus";
import { machineStatusSnapshot } from "../../machineStatus.testSupport";
import { MachineList } from "../MachineList";
import { MachineSwitcher } from "../MachineSwitcher";
import { ProjectList } from "../ProjectList";
import { WorkspaceList } from "../WorkspaceList";
import { AppNavigationPanel, shouldShowMachinesSection } from "./AppNavigationPanel";

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

  it("caps the goal panel so it cannot push sessions off-screen", () => {
    expect(styleText).toContain("goal-panel { flex: 0 1 auto;");
  });

  it("keeps a collapsed section at heading height", () => {
    expect(styleText).toContain("session-list[collapsed] { flex: 0 0 auto;");
  });
});

describe("machine status wiring", () => {
  it("gives machine sections every snapshot and project and workspace sections the selected machine's", async () => {
    const local = machineStatusSnapshot({ machine: { "core:working": true } });
    const remote = machineStatusSnapshot({ machine: { "core:unread": true } });
    const panel = await mountPanel({ local, "remote-a": remote }, machine("local"));

    expect(section(panel, "machine-switcher", MachineSwitcher).statusSnapshots).toEqual({ local, "remote-a": remote });
    expect(section(panel, "machine-list", MachineList).statusSnapshots).toEqual({ local, "remote-a": remote });
    expect(section(panel, "project-list", ProjectList).statusSnapshot).toBe(local);
    expect(section(panel, "workspace-list", WorkspaceList).statusSnapshot).toBe(local);
  });

  it("reads the local machine's snapshot before a machine has been selected", async () => {
    // `selectedMachine` is undefined until machines load, and can stay undefined
    // if that load fails, while local project rows already render. The app keys
    // snapshots by `selectedMachine?.id ?? LOCAL_MACHINE_ID`, so this panel must
    // resolve the same id instead of blanking every indicator.
    const local = machineStatusSnapshot({ projects: { "project-1": { "core:working": true } } });
    const panel = await mountPanel({ local }, undefined);

    expect(section(panel, "project-list", ProjectList).statusSnapshot).toBe(local);
    expect(section(panel, "workspace-list", WorkspaceList).statusSnapshot).toBe(local);
  });

  it("leaves project and workspace sections without a snapshot when the selected machine has none", async () => {
    const panel = await mountPanel({ "remote-a": machineStatusSnapshot() }, machine("local"));

    expect(section(panel, "project-list", ProjectList).statusSnapshot).toBeUndefined();
    expect(section(panel, "workspace-list", WorkspaceList).statusSnapshot).toBeUndefined();
  });
});

async function mountPanel(machineStatusSnapshots: Record<string, MachineStatusSnapshot>, selectedMachine: Machine | undefined): Promise<AppNavigationPanel> {
  const panel = new AppNavigationPanel();
  panel.compact = true;
  panel.machines = [machine("local"), machine("remote-a")];
  if (selectedMachine !== undefined) panel.selectedMachine = selectedMachine;
  panel.projects = [project("project-1")];
  panel.workspaces = [workspace("ws-1", "project-1")];
  panel.machineStatusSnapshots = machineStatusSnapshots;
  document.body.append(panel);
  await panel.updateComplete;
  return panel;
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

function project(id: string): Project {
  return { id, name: id, path: `/repo/${id}`, createdAt: "2026-06-04T00:00:00.000Z" };
}

function workspace(id: string, projectId: string): Workspace {
  return { id, projectId, path: `/repo/${id}`, label: id, isMain: true, effectiveConfig: {} };
}
