interface WorkspaceLike { readonly id: string; readonly projectId: string; readonly path: string }
interface ProjectLike { readonly id: string }

/**
 * Where a session sits. Choosing a session used to move the conversation and
 * leave the project and workspace behind, so the lists beside the conversation
 * described somewhere else.
 *
 * Returns nothing when the directory is not catalogued: an unknown path is not
 * evidence that the current selection is wrong.
 */
export function ancestorsForSession<W extends WorkspaceLike, P extends ProjectLike>(
  session: { readonly cwd: string | undefined },
  catalogue: { readonly workspaces: readonly W[]; readonly projects: readonly P[] },
): { workspace: W; project: P } | undefined {
  const cwd = session.cwd;
  if (cwd === undefined || cwd === "") return undefined;
  const workspace = catalogue.workspaces.find((candidate) => candidate.path === cwd);
  if (workspace === undefined) return undefined;
  const project = catalogue.projects.find((candidate) => candidate.id === workspace.projectId);
  if (project === undefined) return undefined;
  return { workspace, project };
}
