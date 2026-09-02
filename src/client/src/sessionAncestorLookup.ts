/**
 * Find the workspace that owns a session directory, asking the catalogue when
 * the loaded one cannot answer.
 *
 * `selectSession` resolves a session's workspace from the projects already in
 * memory, and those are only the selected project's. Opening a session from
 * another project resolved nothing, the previous selection stayed put, and
 * every workspace-scoped panel kept answering for the project being left - the
 * goal panel rendered another project's goal with live Resume and Abandon
 * buttons, because its key still matched.
 *
 * Undefined means "nobody claims this directory", which the caller must treat
 * as unknown rather than as an empty workspace.
 */
export interface WorkspaceCatalogue<W extends { path: string }, P> {
  projects: () => Promise<readonly P[]>;
  workspaces: (projectId: string) => Promise<readonly W[]>;
}

export async function locateSessionWorkspace<W extends { path: string }, P extends { id: string }>(
  cwd: string,
  catalogue: WorkspaceCatalogue<W, P>,
): Promise<{ workspace: W; project: P } | undefined> {
  if (cwd === "") return undefined;
  let projects: readonly P[];
  try {
    projects = await catalogue.projects();
  } catch {
    // Offline or refused: the caller keeps treating the location as unknown.
    return undefined;
  }
  for (const project of projects) {
    let workspaces: readonly W[];
    try {
      workspaces = await catalogue.workspaces(project.id);
    } catch {
      // One unreadable project must not hide the answer in the next one.
      continue;
    }
    const workspace = workspaces.find((candidate) => candidate.path === cwd);
    if (workspace !== undefined) return { workspace, project };
  }
  return undefined;
}
