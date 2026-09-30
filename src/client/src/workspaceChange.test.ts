import { describe, expect, it } from "vitest";
import { refreshOnReturn, workspaceChangeVerdict } from "./workspaceChange";

const shown = { selectedMachineId: "local", selectedWorkspacePath: "/repo", visible: true };

describe("workspaceChangeVerdict", () => {
  it("enumerates every verdict", () => {
    expect(workspaceChangeVerdict({ ...shown, eventMachineId: "remote", eventCwd: "/repo" })).toEqual({ kind: "ignore", reason: "other-machine" });
    expect(workspaceChangeVerdict({ ...shown, eventMachineId: "local", eventCwd: "/repo", selectedMachineId: undefined })).toEqual({ kind: "ignore", reason: "other-machine" });
    expect(workspaceChangeVerdict({ ...shown, eventMachineId: "local", eventCwd: "/repo", selectedWorkspacePath: undefined })).toEqual({ kind: "ignore", reason: "no-workspace" });
    expect(workspaceChangeVerdict({ ...shown, eventMachineId: "local", eventCwd: "/elsewhere" })).toEqual({ kind: "ignore", reason: "other-directory" });
    expect(workspaceChangeVerdict({ ...shown, eventMachineId: "local", eventCwd: "/repo-two" })).toEqual({ kind: "ignore", reason: "other-directory" });
    expect(workspaceChangeVerdict({ ...shown, eventMachineId: "local", eventCwd: "/repo" })).toEqual({ kind: "refresh", reason: "same-directory" });
    expect(workspaceChangeVerdict({ ...shown, eventMachineId: "local", eventCwd: "/repo/packages/app" })).toEqual({ kind: "refresh", reason: "inside-workspace" });
    expect(workspaceChangeVerdict({ ...shown, eventMachineId: "local", eventCwd: "/repo", visible: false })).toEqual({ kind: "defer", scope: { machineId: "local", workspacePath: "/repo" } });
    expect(workspaceChangeVerdict({ ...shown, eventMachineId: "remote", eventCwd: "/repo", visible: false })).toEqual({ kind: "ignore", reason: "other-machine" });
  });
});

describe("refreshOnReturn", () => {
  it("refreshes once on return only for the workspace that changed while hidden and is still on screen", () => {
    const deferred = { machineId: "local", workspacePath: "/repo" };
    const cases = {
      "nothing deferred": refreshOnReturn(undefined, { selectedMachineId: "local", selectedWorkspacePath: "/repo" }),
      "same workspace": refreshOnReturn(deferred, { selectedMachineId: "local", selectedWorkspacePath: "/repo" }),
      "moved to another workspace": refreshOnReturn(deferred, { selectedMachineId: "local", selectedWorkspacePath: "/other" }),
      "moved to another machine": refreshOnReturn(deferred, { selectedMachineId: "remote", selectedWorkspacePath: "/repo" }),
      "no workspace": refreshOnReturn(deferred, { selectedMachineId: "local", selectedWorkspacePath: undefined }),
    };
    expect(cases).toEqual({ "nothing deferred": false, "same workspace": true, "moved to another workspace": false, "moved to another machine": false, "no workspace": false });
  });
});
