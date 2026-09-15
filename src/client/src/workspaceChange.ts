/**
 * Whether a `workspace.changed` frame belongs to the workspace on screen.
 *
 * The daemon names a directory; only the browser knows which machine the
 * frame came from and which workspace it is showing. A frame from another
 * machine, or for a directory outside the shown workspace, is somebody
 * else's news and must not refresh this panel - data carries its scope
 * (machine + workspace), and a refresh triggered by the wrong scope would
 * show one workspace reacting to another's edits.
 */
export type WorkspaceChangeVerdict =
  | { kind: "ignore"; reason: "other-machine" | "no-workspace" | "other-directory" }
  | { kind: "refresh"; reason: "same-directory" | "inside-workspace" };

export function workspaceChangeVerdict(input: {
  eventMachineId: string;
  eventCwd: string;
  selectedMachineId: string | undefined;
  selectedWorkspacePath: string | undefined;
}): WorkspaceChangeVerdict {
  if (input.selectedMachineId === undefined || input.eventMachineId !== input.selectedMachineId) return { kind: "ignore", reason: "other-machine" };
  if (input.selectedWorkspacePath === undefined) return { kind: "ignore", reason: "no-workspace" };
  if (input.eventCwd === input.selectedWorkspacePath) return { kind: "refresh", reason: "same-directory" };
  if (isInsideDirectory(input.eventCwd, input.selectedWorkspacePath)) return { kind: "refresh", reason: "inside-workspace" };
  return { kind: "ignore", reason: "other-directory" };
}

/**
 * A session can live in a subdirectory of the workspace it is listed under
 * (the workspace list covers its directory tree), so its directory's news is
 * the workspace's news. Segment-wise, so `/repo-two` is not inside `/repo`.
 */
function isInsideDirectory(candidate: string, directory: string): boolean {
  const base = directory.endsWith("/") ? directory : `${directory}/`;
  return candidate.startsWith(base);
}
