/**
 * Whether a `workspace.changed` frame belongs to the workspace on screen.
 *
 * The daemon names a directory; only the browser knows which machine the
 * frame came from and which workspace it is showing. A frame from another
 * machine, or for a directory outside the shown workspace, is somebody
 * else's news and must not refresh this panel - data carries its scope
 * (machine + workspace), and a refresh triggered by the wrong scope would
 * show one workspace reacting to another's edits.
 *
 * A hidden tab refreshes nothing: it remembers which workspace changed and
 * refreshes it once when the tab is shown again (the GitLens suspend and
 * resume, research run 8f558e71). Refreshing panels no one sees was part of
 * the git status and tree reads that were 74 % of 8504's traffic.
 */
export type WorkspaceChangeVerdict =
  | { kind: "ignore"; reason: "other-machine" | "no-workspace" | "other-directory" }
  | { kind: "refresh"; reason: "same-directory" | "inside-workspace" }
  | { kind: "defer"; scope: WorkspaceScope };

export interface WorkspaceScope {
  readonly machineId: string;
  readonly workspacePath: string;
}

export function workspaceChangeVerdict(input: {
  eventMachineId: string;
  eventCwd: string;
  selectedMachineId: string | undefined;
  selectedWorkspacePath: string | undefined;
  visible: boolean;
}): WorkspaceChangeVerdict {
  if (input.selectedMachineId === undefined || input.eventMachineId !== input.selectedMachineId) return { kind: "ignore", reason: "other-machine" };
  if (input.selectedWorkspacePath === undefined) return { kind: "ignore", reason: "no-workspace" };
  const reason = input.eventCwd === input.selectedWorkspacePath ? "same-directory" as const : isInsideDirectory(input.eventCwd, input.selectedWorkspacePath) ? "inside-workspace" as const : undefined;
  if (reason === undefined) return { kind: "ignore", reason: "other-directory" };
  if (!input.visible) return { kind: "defer", scope: { machineId: input.selectedMachineId, workspacePath: input.selectedWorkspacePath } };
  return { kind: "refresh", reason };
}

/** On return to the tab: refresh only if the workspace that changed while hidden is still the one on screen. */
export function refreshOnReturn(deferred: WorkspaceScope | undefined, selection: { selectedMachineId: string | undefined; selectedWorkspacePath: string | undefined }): boolean {
  if (deferred === undefined) return false;
  return deferred.machineId === selection.selectedMachineId && deferred.workspacePath === selection.selectedWorkspacePath;
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
