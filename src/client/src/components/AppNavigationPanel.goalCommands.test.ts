// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { GoalRecordSummary, SessionInfo, Workspace } from "../api";
import { AppNavigationPanel } from "./appShell/AppNavigationPanel";

afterEach(() => { document.body.replaceChildren(); });

const workspace: Workspace = {
  id: "/repo",
  projectId: "project-1",
  path: "/repo",
  label: "repo",
  isMain: true,
  effectiveConfig: {},
};

const session: SessionInfo = {
  id: "s1",
  cwd: "/repo",
  path: "/repo/.sessions/s1",
  created: "now",
  modified: "now",
  messageCount: 1,
  firstMessage: "hello",
};

const goal: GoalRecordSummary = {
  id: "goal-1",
  objective: "Ship the fix",
  status: "paused",
  path: "/repo/.pi/goals/goal-1.json",
  sisyphus: false,
  autoContinue: false,
  tasks: [],
  completedTaskCount: 14,
  totalTaskCount: 20,
};

/**
 * The goals panel's action controls act on the focused session on behalf of a
 * workspace. When the goals state answers for a different workspace than the
 * one selected, acting must be impossible: the host withholds the permission
 * and the panel renders the controls disabled with a reason.
 */
describe("the goals panel's action permission", () => {
  it("disables the commands when the host withholds them", async () => {
    const panel = await mount({ goals: [goal], selectedSession: session, canRunGoalCommands: false });

    const inner = goalPanel(panel);
    expect(inner?.canRunCommands).toBe(false);
    const resume = [...inner?.shadowRoot?.querySelectorAll<HTMLButtonElement>(".goal-command") ?? []]
      .find((button) => button.textContent.trim() === "Resume");
    expect(resume?.disabled).toBe(true);
  });

  it("keeps the commands available when the host grants them", async () => {
    const panel = await mount({ goals: [goal], selectedSession: session, canRunGoalCommands: true });

    const inner = goalPanel(panel);
    expect(inner?.canRunCommands).toBe(true);
  });

  /**
   * A failed read must not make the section vanish: "the read failed" and
   * "nothing to report" are different answers.
   */
  it("renders the section when the read failed even with no rows", async () => {
    const panel = await mount({ goals: [], goalsFailed: true });

    expect(goalPanel(panel)).not.toBeNull();
  });
});

function goalPanel(panel: AppNavigationPanel): import("./GoalPanel").GoalPanel | null | undefined {
  return panel.shadowRoot?.querySelector("goal-panel");
}

interface MountOptions {
  goals: GoalRecordSummary[];
  selectedSession?: SessionInfo;
  canRunGoalCommands?: boolean;
  goalsFailed?: boolean;
}

async function mount(options: MountOptions): Promise<AppNavigationPanel> {
  const panel = new AppNavigationPanel();
  panel.selectedWorkspace = workspace;
  // The goals section renders only on the sessions view; collapse the others.
  panel.projectsCollapsed = true;
  panel.workspacesCollapsed = true;
  panel.sessionsCollapsed = true;
  panel.goals = options.goals;
  if (options.selectedSession !== undefined) panel.selectedSession = options.selectedSession;
  if (options.canRunGoalCommands !== undefined) panel.canRunGoalCommands = options.canRunGoalCommands;
  if (options.goalsFailed !== undefined) panel.goalsFailed = options.goalsFailed;
  document.body.append(panel);
  await panel.updateComplete;
  return panel;
}
