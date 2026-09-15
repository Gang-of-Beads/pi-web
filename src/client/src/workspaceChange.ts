/**
 * Whether a `workspace.changed` frame belongs to the workspace on screen.
 *
 * The daemon names a directory; only the browser knows which machine the
 * frame came from and which workspace it is showing. A frame from another
 * machine, or for another directory, is somebody else's news and must not
 * refresh this panel - data carries its scope (machine + workspace), and a
 * refresh triggered by the wrong scope would show one workspace reacting to
 * another's edits.
 */
export type WorkspaceChangeVerdict =
  | { kind: "ignore"; reason: "other-machine" | "no-workspace" | "other-directory" }
  | { kind: "refresh" };

export function workspaceChangeVerdict(input: {
  eventMachineId: string;
  eventCwd: string;
  selectedMachineId: string | undefined;
  selectedWorkspacePath: string | undefined;
}): WorkspaceChangeVerdict {
  if (input.selectedMachineId === undefined || input.eventMachineId !== input.selectedMachineId) return { kind: "ignore", reason: "other-machine" };
  if (input.selectedWorkspacePath === undefined) return { kind: "ignore", reason: "no-workspace" };
  if (input.eventCwd !== input.selectedWorkspacePath) return { kind: "ignore", reason: "other-directory" };
  return { kind: "refresh" };
}
