/**
 * Where a session's directory sits among a machine's open projects, asking
 * the catalogue when the loaded one cannot answer.
 *
 * `selectSession` resolves a session's workspace from the projects already in
 * memory, and those are only the selected project's. Opening a session from
 * another project resolved nothing, the previous selection stayed put, and
 * every workspace-scoped panel kept answering for the project being left - the
 * goal panel rendered another project's goal with live Resume and Abandon
 * buttons, because its key still matched.
 *
 * The answer is typed, because "nobody claims this directory" and "someone did
 * not answer" lead to opposite acts (B49): a session whose project is closed
 * (a pin outlives its project) is `outside` every open project, and the page
 * must stop naming the project it was in; while a project has not answered the
 * place is `unknown`, and nothing moves. A workspace owns a directory it is,
 * or that lies under it (workspaces list their subdirectories' sessions); an
 * exact match wins at once, otherwise the deepest owner once every project has
 * answered.
 *
 * Every project is asked at once: a project's read waits until it answers
 * (B48), so asking in turn let one project that never answers hide the owner
 * behind it. A catalogue read that resolves undefined had no answer the caller
 * still wants.
 */
import { sessionLocationVerdict } from "./sessionLocationVerdict";

export type SessionPlace<W, P> =
  | { readonly kind: "found"; readonly workspace: W; readonly project: P; readonly workspaces: readonly W[] }
  | { readonly kind: "outside" }
  | { readonly kind: "unknown" };

interface Catalogue<W, P> {
  projects: () => Promise<readonly P[] | undefined>;
  workspaces: (projectId: string) => Promise<readonly W[] | undefined>;
}

const UNKNOWN = { kind: "unknown" } as const;
const OUTSIDE = { kind: "outside" } as const;

export async function locateSessionWorkspace<W extends { path: string }, P extends { id: string }>(cwd: string, catalogue: Catalogue<W, P>): Promise<SessionPlace<W, P>> {
  if (cwd === "") return UNKNOWN;
  let projects: readonly P[] | undefined;
  try {
    projects = await catalogue.projects();
  } catch {
    return UNKNOWN;
  }
  if (projects === undefined) return UNKNOWN;
  if (projects.length === 0) return OUTSIDE;
  return owner(cwd, projects, catalogue.workspaces);
}

function owner<W extends { path: string }, P extends { id: string }>(
  cwd: string,
  projects: readonly P[],
  workspacesOf: (projectId: string) => Promise<readonly W[] | undefined>,
): Promise<SessionPlace<W, P>> {
  return new Promise((resolve) => {
    let unsettled = projects.length;
    let unanswered = false;
    const containing: { workspace: W; project: P; workspaces: readonly W[] }[] = [];
    for (const project of projects) {
      workspacesOf(project.id)
        .then((workspaces) => {
          if (workspaces === undefined) {
            unanswered = true;
            return;
          }
          const exact = workspaces.find((candidate) => candidate.path === cwd);
          if (exact !== undefined) resolve({ kind: "found", workspace: exact, project, workspaces });
          for (const workspace of workspaces) if (sessionLocationVerdict(cwd, workspace.path) === "described") containing.push({ workspace, project, workspaces });
        }, () => { unanswered = true; })
        .finally(() => {
          unsettled -= 1;
          if (unsettled > 0) return;
          if (unanswered) {
            resolve(UNKNOWN);
            return;
          }
          const deepest = containing.sort((left, right) => right.workspace.path.length - left.workspace.path.length)[0];
          resolve(deepest === undefined ? OUTSIDE : { kind: "found", ...deepest });
        });
    }
  });
}
