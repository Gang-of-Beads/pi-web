import { describe, expect, it } from "vitest";
import type { GoalRecordSummary, Workspace } from "./api";
import { canActOnWorkspaceGoals, goalsForSelectedWorkspace, initialAppState, type AppState, type PanelLoad } from "./appState";
import { machineWorkspaceKey } from "./machineKeys";

const workspace: Workspace = { id: "ws-1", projectId: "p1", path: "/repo", label: "repo", isMain: true } as Workspace;

function stateWith(slot: PanelLoad<GoalRecordSummary[]>, selected: Workspace = workspace): AppState {
  return { ...initialAppState(), selectedWorkspace: selected, workspaceGoalsLoad: slot };
}

const rows: GoalRecordSummary[] = [{ id: "goal-a", path: "/repo/.pi/goals/goal-a.json", name: "A", status: "active", tasks: [], tokensUsed: 0, pausedReason: undefined, revision: 0 } as unknown as GoalRecordSummary];

describe("the goals load slot", () => {
  // "No goals recorded for this workspace" was rendered while the goal file sat
  // active on disk, because a retained list keyed to another workspace collapsed
  // to [] and the panel could not tell that apart from a read that found nothing.
  it("reads a slot keyed to another selection as unloaded for this one", () => {
    const otherKey = machineWorkspaceKey("local", "p2", "ws-2");
    const state = stateWith({ state: "loaded", key: otherKey, data: rows });

    const load = goalsForSelectedWorkspace(state);
    expect(load.state).toBe("unloaded");
    expect(load.data).toEqual([]);
  });

  it("reads a slot with no key at all as unloaded", () => {
    const load = goalsForSelectedWorkspace(stateWith({ state: "loaded", key: undefined, data: rows }));
    expect(load.state).toBe("unloaded");
  });

  it("hands through a slot that answers for the current selection", () => {
    const key = machineWorkspaceKey("local", workspace.projectId, workspace.id);
    const load = goalsForSelectedWorkspace(stateWith({ state: "loaded", key, data: rows }));
    expect(load.state).toBe("loaded");
    expect(load.data).toEqual(rows);
    expect(load.key).toBe(key);
  });

  it("keeps a failed read failed for its own selection, not empty", () => {
    const key = machineWorkspaceKey("local", workspace.projectId, workspace.id);
    const load = goalsForSelectedWorkspace(stateWith({ state: "failed", key, data: rows }));
    expect(load.state).toBe("failed");
    expect(load.data).toEqual(rows);
  });

  it("allows acting only when the slot answers for the current selection", () => {
    const key = machineWorkspaceKey("local", workspace.projectId, workspace.id);
    expect(canActOnWorkspaceGoals(stateWith({ state: "loaded", key, data: rows }))).toBe(true);
    expect(canActOnWorkspaceGoals(stateWith({ state: "loaded", key: machineWorkspaceKey("local", "p2", "ws-2"), data: rows }))).toBe(false);
    expect(canActOnWorkspaceGoals(stateWith({ state: "loaded", key: undefined, data: rows }))).toBe(false);
  });

  it("starts unloaded", () => {
    const state = { ...initialAppState(), selectedWorkspace: workspace };
    expect(goalsForSelectedWorkspace(state).state).toBe("unloaded");
  });
});
