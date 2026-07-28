import type { Project, Workspace } from "../types.js";
import { cwdPathsEqual } from "../workingDirectory.js";

interface ProjectLister {
  list(): Promise<Project[]>;
}

interface WorkspaceLister {
  list(project: Project): Promise<Workspace[]>;
}

export interface ProjectWorkspaceCwdsDeps {
  projects: ProjectLister;
  workspaces: WorkspaceLister;
}

/**
 * Resolves the set of workspace paths that belong to the same registered project
 * as a given working directory.
 *
 * Sessions spawned by an agent are constrained to workspaces of the spawning
 * session's own project, so this set bounds where related sessions of any cwd
 * can live. It is evaluated live so a worktree created with `git worktree add`
 * moments ago is included.
 */
export interface ProjectWorkspaceCwds {
  /**
   * Workspace paths of the registered project containing `cwd`, or undefined
   * when no registered project contains it. The result includes `cwd` itself.
   */
  forCwd(cwd: string): Promise<string[] | undefined>;
}

export class RegisteredProjectWorkspaceCwds implements ProjectWorkspaceCwds {
  constructor(private readonly deps: ProjectWorkspaceCwdsDeps) {}

  async forCwd(cwd: string): Promise<string[] | undefined> {
    const projects = await this.deps.projects.list();
    for (const project of projects) {
      const workspaces = await this.deps.workspaces.list(project);
      const paths = workspaces.map((workspace) => workspace.path);
      if (paths.some((path) => cwdPathsEqual(path, cwd))) return paths;
    }
    return undefined;
  }
}

/** Workspace paths of `cwd`'s project other than `cwd` itself. */
export async function siblingWorkspaceCwds(locator: ProjectWorkspaceCwds, cwd: string): Promise<string[]> {
  const paths = await locator.forCwd(cwd);
  return (paths ?? []).filter((path) => !cwdPathsEqual(path, cwd));
}
