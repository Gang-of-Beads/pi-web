import { describe, expect, it } from "vitest";
import { workspaceChangeVerdict } from "./workspaceChange";

describe("workspaceChangeVerdict", () => {
  it("enumerates every verdict", () => {
    expect(workspaceChangeVerdict({ eventMachineId: "remote", eventCwd: "/repo", selectedMachineId: "local", selectedWorkspacePath: "/repo" })).toEqual({ kind: "ignore", reason: "other-machine" });
    expect(workspaceChangeVerdict({ eventMachineId: "local", eventCwd: "/repo", selectedMachineId: undefined, selectedWorkspacePath: "/repo" })).toEqual({ kind: "ignore", reason: "other-machine" });
    expect(workspaceChangeVerdict({ eventMachineId: "local", eventCwd: "/repo", selectedMachineId: "local", selectedWorkspacePath: undefined })).toEqual({ kind: "ignore", reason: "no-workspace" });
    expect(workspaceChangeVerdict({ eventMachineId: "local", eventCwd: "/repo/other", selectedMachineId: "local", selectedWorkspacePath: "/repo" })).toEqual({ kind: "ignore", reason: "other-directory" });
    expect(workspaceChangeVerdict({ eventMachineId: "local", eventCwd: "/repo", selectedMachineId: "local", selectedWorkspacePath: "/repo" })).toEqual({ kind: "refresh" });
  });
});
