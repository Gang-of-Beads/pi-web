// @vitest-environment happy-dom

import { html } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import { AppNavigationPanel } from "./appShell/AppNavigationPanel";
import type { QualifiedDrawerSectionContribution } from "../plugins/types";
import type { SessionInfo, Workspace } from "../api";

afterEach(() => { document.body.replaceChildren(); });

const session: SessionInfo = {
  id: "s1",
  cwd: "/repo",
  path: "/repo/.sessions/s1",
  created: "now",
  modified: "now",
  messageCount: 1,
  firstMessage: "hello",
};
const workspace: Workspace = {
  id: "/repo",
  projectId: "project-1",
  path: "/repo",
  label: "repo",
  isMain: true,
  effectiveConfig: {},
};

function section(patch: Partial<QualifiedDrawerSectionContribution> = {}): QualifiedDrawerSectionContribution {
  return {
    id: "goals:goals",
    pluginId: "goals",
    localId: "goals",
    title: "Goals",
    render: () => html`<div class="contributed-section"></div>`,
    ...patch,
  };
}

async function mount(sections: QualifiedDrawerSectionContribution[], options: { withSession?: boolean } = {}): Promise<AppNavigationPanel> {
  const panel = new AppNavigationPanel();
  panel.drawerSections = sections;
  if (options.withSession !== false) panel.selectedSession = session;
  panel.selectedWorkspace = workspace;
  panel.projectsCollapsed = true;
  panel.workspacesCollapsed = true;
  panel.sessionsCollapsed = false;
  document.body.append(panel);
  await panel.updateComplete;
  await panel.updateComplete;
  return panel;
}

function contributed(panel: AppNavigationPanel): number {
  return panel.shadowRoot?.querySelectorAll(".contributed-section").length ?? 0;
}

describe("contributed sections in the navigation panel", () => {
  it("draws a contributed section beside the session list", async () => {
    const panel = await mount([section()]);

    expect(contributed(panel)).toBeGreaterThan(0);
  });

  it("draws nothing for a section that says it has nothing", async () => {
    const panel = await mount([section({ available: () => false })]);

    expect(contributed(panel)).toBe(0);
  });

  it("still draws a section that cannot say yet", async () => {
    const panel = await mount([section({ available: () => undefined })]);

    expect(contributed(panel)).toBeGreaterThan(0);
  });

  it("draws nothing while no session is selected", async () => {
    const panel = await mount([section()], { withSession: false });

    expect(contributed(panel)).toBe(0);
  });
});
