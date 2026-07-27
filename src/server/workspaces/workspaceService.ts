import { createHash } from "node:crypto";
import type { Project } from "../types.js";
import type { Workspace } from "../types.js";
import { discoverGitWorktrees, isGitRepository, type GitWorktreeInfo } from "./gitWorktreeDiscovery.js";

const idFor = (value: string) => createHash("sha1").update(value).digest("hex").slice(0, 12);

/** The git facts this service needs, injectable so workspace policy is testable without a real repo. */
export interface WorkspaceGitPort {
  isGitRepository(path: string): Promise<boolean>;
  discoverGitWorktrees(path: string): Promise<GitWorktreeInfo[]>;
}

const realGit: WorkspaceGitPort = { isGitRepository, discoverGitWorktrees };

export class WorkspaceService {
  constructor(private readonly git: WorkspaceGitPort = realGit) {}

  async list(project: Project): Promise<Workspace[]> {
    const isGitRepo = await this.git.isGitRepository(project.path);
    if (!isGitRepo) {
      return [this.single(project, false)];
    }

    const worktrees = this.selectable(await this.git.discoverGitWorktrees(project.path), project);
    if (worktrees.length === 0) return [this.single(project, true)];

    return worktrees.map((worktree) => {
      const leafName = worktree.path.split("/").filter((part) => part !== "").at(-1);
      return {
        id: idFor(`${project.id}:${worktree.path}`),
        projectId: project.id,
        path: worktree.path,
        label: worktree.branch ?? (worktree.detached === true ? "detached" : leafName ?? worktree.path),
        ...(worktree.branch === undefined ? {} : { branch: worktree.branch }),
        isMain: worktree.path === project.path,
        isGitRepo: true,
        isGitWorktree: true,
      };
    });
  }

  /**
   * Git keeps listing a linked worktree after its checkout directory is deleted outside PI WEB,
   * marking it `prunable`. Such an entry is not a usable workspace, so it is hidden rather than
   * offered as a selectable ghost. Listing stays read-only: we never run `git worktree prune`.
   * The project's own path is always kept so a project cannot end up with no workspace at all.
   */
  private selectable(worktrees: GitWorktreeInfo[], project: Project): GitWorktreeInfo[] {
    return worktrees.filter((worktree) => worktree.prunable !== true || worktree.path === project.path);
  }

  private single(project: Project, isGitRepo: boolean): Workspace {
    return {
      id: idFor(`${project.id}:${project.path}`),
      projectId: project.id,
      path: project.path,
      label: project.name,
      isMain: true,
      isGitRepo,
      isGitWorktree: false,
    };
  }
}
