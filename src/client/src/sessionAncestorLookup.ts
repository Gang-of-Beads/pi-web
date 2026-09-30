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
 * as unknown rather than as an empty workspace. A catalogue read that resolves
 * undefined had no answer the caller still wants.
 *
 * Every project is asked at once and the first owner wins: a project's read
 * waits until it answers (B48), so asking in turn let one project that never
 * answers hide the owner behind it.
 */
export async function locateSessionWorkspace<W extends { path: string }, P extends { id: string }>(
  cwd: string,
  catalogue: { projects: () => Promise<readonly P[] | undefined>; workspaces: (projectId: string) => Promise<readonly W[] | undefined> },
): Promise<{ workspace: W; project: P; workspaces: readonly W[] } | undefined> {
  if (cwd === "") return undefined;
  let projects: readonly P[] | undefined;
  try {
    projects = await catalogue.projects();
  } catch {
    return undefined;
  }
  if (projects === undefined || projects.length === 0) return undefined;
  return firstOwner(cwd, projects, catalogue.workspaces);
}

function firstOwner<W extends { path: string }, P extends { id: string }>(
  cwd: string,
  projects: readonly P[],
  workspacesOf: (projectId: string) => Promise<readonly W[] | undefined>,
): Promise<{ workspace: W; project: P; workspaces: readonly W[] } | undefined> {
  return new Promise((resolve) => {
    let unsettled = projects.length;
    for (const project of projects) {
      workspacesOf(project.id)
        .then((workspaces) => {
          const workspace = workspaces?.find((candidate) => candidate.path === cwd);
          if (workspace !== undefined && workspaces !== undefined) resolve({ workspace, project, workspaces });
        }, () => undefined)
        .finally(() => {
          unsettled -= 1;
          if (unsettled === 0) resolve(undefined);
        });
    }
  });
}
