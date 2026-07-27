import { describe, expect, it } from "vitest";
import { parseGitWorktreeList } from "./gitWorktreeDiscovery.js";

// Fixtures below are verbatim `git worktree list --porcelain` output captured from real git.
const mainAndLinked = [
  "worktree /repo",
  "HEAD ad580ab86e1eba35a121fa6b9e8be1126aaf18de",
  "branch refs/heads/main",
  "",
  "worktree /repo-worktrees/feature",
  "HEAD ad580ab86e1eba35a121fa6b9e8be1126aaf18de",
  "branch refs/heads/feat/thing",
  "",
].join("\n");

const removedAndLocked = [
  "worktree /repo",
  "HEAD ad580ab86e1eba35a121fa6b9e8be1126aaf18de",
  "branch refs/heads/main",
  "",
  "worktree /repo-worktrees/gone",
  "HEAD ad580ab86e1eba35a121fa6b9e8be1126aaf18de",
  "branch refs/heads/gone",
  "prunable gitdir file points to non-existent location",
  "",
  "worktree /repo-worktrees/kept",
  "HEAD ad580ab86e1eba35a121fa6b9e8be1126aaf18de",
  "branch refs/heads/kept",
  "locked keep me",
  "",
].join("\n");

describe("parseGitWorktreeList", () => {
  it("reads paths and short branch names for the main and linked worktrees", () => {
    expect(parseGitWorktreeList(mainAndLinked)).toEqual([
      { path: "/repo", branch: "main" },
      { path: "/repo-worktrees/feature", branch: "feat/thing" },
    ]);
  });

  it("reports prunable, and leaves a locked worktree looking like the usable checkout it is", () => {
    expect(parseGitWorktreeList(removedAndLocked)).toEqual([
      { path: "/repo", branch: "main" },
      { path: "/repo-worktrees/gone", branch: "gone", prunable: true },
      // `locked` is ignored: a locked worktree is a real checkout and stays a usable
      // workspace, so nothing downstream needs to distinguish it.
      { path: "/repo-worktrees/kept", branch: "kept" },
    ]);

    const bareLocked = ["worktree /repo-worktrees/kept", "HEAD abc", "detached", "locked", ""].join("\n");
    expect(parseGitWorktreeList(bareLocked)).toEqual([{ path: "/repo-worktrees/kept", detached: true }]);
  });

  it("reads bare repositories and ignores chunks without a worktree path", () => {
    const bare = ["worktree /repo.git", "bare", "", "HEAD abc", ""].join("\n");
    expect(parseGitWorktreeList(bare)).toEqual([{ path: "/repo.git", bare: true }]);
  });

  it("returns nothing for empty output", () => {
    expect(parseGitWorktreeList("\n")).toEqual([]);
  });
});
