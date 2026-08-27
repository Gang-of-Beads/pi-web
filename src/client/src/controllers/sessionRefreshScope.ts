export function refreshMayReplaceSelection(scope: {
  refreshedWorkspacePath: string;
  selectedSessionCwd: string | undefined;
}): boolean {
  return scope.selectedSessionCwd !== undefined && scope.selectedSessionCwd === scope.refreshedWorkspacePath;
}
