import { describe, expect, it } from "vitest";
import type { Project } from "../types.js";
import type { GitWorktreeInfo } from "./gitWorktreeDiscovery.js";
import { WorkspaceService, type WorkspaceGitPort } from "./workspaceService.js";

const project: Project = {
  id: "p1",
  name: "Project",
  path: "/repo",
  createdAt: "2026-05-25T00:00:00.000Z",
};

function serviceFor(worktrees: GitWorktreeInfo[], isGitRepo = true): WorkspaceService {
  const git: WorkspaceGitPort = {
    isGitRepository: () => Promise.resolve(isGitRepo),
    discoverGitWorktrees: () => Promise.resolve(worktrees),
  };
  return new WorkspaceService(git);
}

describe("WorkspaceService.list", () => {
  it("hides a linked worktree whose checkout directory was removed outside PI WEB", async () => {
    const service = serviceFor([
      { path: "/repo", branch: "main" },
      { path: "/repo-worktrees/gone", branch: "gone", prunable: true },
      { path: "/repo-worktrees/live", branch: "live" },
    ]);

    const workspaces = await service.list(project);

    expect(workspaces.map((workspace) => workspace.path)).toEqual(["/repo", "/repo-worktrees/live"]);
  });

  it("keeps a worktree that is present but not prunable, such as a locked one", async () => {
    const service = serviceFor([
      { path: "/repo", branch: "main" },
      { path: "/repo-worktrees/kept", branch: "kept" },
    ]);

    const workspaces = await service.list(project);

    expect(workspaces.map((workspace) => workspace.path)).toEqual(["/repo", "/repo-worktrees/kept"]);
  });

  it("keeps the project's own worktree even if git marks it prunable, so a project is never empty", async () => {
    const service = serviceFor([{ path: "/repo", branch: "main", prunable: true }]);

    const workspaces = await service.list(project);

    expect(workspaces).toEqual([expect.objectContaining({ path: "/repo", label: "main", isMain: true, isGitWorktree: true })]);
  });

  it("falls back to the project itself when every linked worktree is filtered away", async () => {
    const service = serviceFor([{ path: "/repo-worktrees/gone", branch: "gone", prunable: true }]);

    const workspaces = await service.list(project);

    expect(workspaces).toEqual([expect.objectContaining({ path: "/repo", label: "Project", isMain: true, isGitRepo: true, isGitWorktree: false })]);
  });

  it("labels detached and unnamed worktrees without inventing a branch", async () => {
    const service = serviceFor([
      { path: "/repo", branch: "main" },
      { path: "/repo-worktrees/detached", detached: true },
    ]);

    const workspaces = await service.list(project);

    expect(workspaces.map((workspace) => ({ label: workspace.label, branch: workspace.branch }))).toEqual([
      { label: "main", branch: "main" },
      { label: "detached", branch: undefined },
    ]);
  });

  it("returns a single non-git workspace when the project is not a repository", async () => {
    const service = serviceFor([], false);

    expect(await service.list(project)).toEqual([expect.objectContaining({ path: "/repo", isGitRepo: false, isGitWorktree: false })]);
  });
});
