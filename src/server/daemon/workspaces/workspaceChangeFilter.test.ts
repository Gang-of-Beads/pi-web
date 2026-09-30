import { describe, expect, it } from "vitest";
import { classifyWorkspaceChange } from "./workspaceChangeFilter.js";

describe("classifyWorkspaceChange", () => {
  it("keeps what moves git state, drops git's own churn and the workspace's noise, and treats the rest as the tree", () => {
    const table = Object.fromEntries([
      ".git/HEAD", ".git/index", ".git/packed-refs", ".git/config", ".git/ORIG_HEAD", ".git/FETCH_HEAD", ".git/MERGE_MSG",
      ".git/refs/heads/main", ".git/refs/remotes/origin/main", ".git/rebase-merge/done", ".git/sequencer/todo", ".git/info/exclude",
      ".git/index.lock", ".git/refs/heads/main.lock", ".git/objects/ab/cdef", ".git/logs/HEAD", ".git/fsmonitor--daemon/cookies/x", ".git/hooks/pre-commit",
      "src/app.ts", "README.md", "docs/design/object-model.md", ".gitignore", ".pi/goals/active_goal.md",
      "node_modules/lit/index.js", "packages/a/node_modules/x.js", ".pi/tasks/abc.output", ".pi/delegate/run.jsonl", ".watchman-cookie-host-1",
      ".git/worktrees/wt/logs/HEAD", ".git/worktrees/wt/index", "vendor/lib/.git/objects/ab/cd", "vendor/lib/.git/HEAD", ".git", ".git\\refs\\heads\\main",
      "sub/.pi/tasks/x.output", ".pi/sessions/s.jsonl", "apps/web/.pi/sessions/s.jsonl", ".pi/settings.json",
      ".git/modules/lib/HEAD", ".git/modules/lib/refs/heads/main", ".git/modules/lib/objects/ab/cd", ".git/modules/lib/index.lock", ".git/modules/lib/modules/inner/index",
      "", undefined,
    ].map((path) => [String(path), classifyWorkspaceChange(path)]));
    expect(table).toEqual({
      ".git/HEAD": "git-state", ".git/index": "git-state", ".git/packed-refs": "git-state", ".git/config": "git-state", ".git/ORIG_HEAD": "git-state", ".git/FETCH_HEAD": "git-state", ".git/MERGE_MSG": "git-state",
      ".git/refs/heads/main": "git-state", ".git/refs/remotes/origin/main": "git-state", ".git/rebase-merge/done": "git-state", ".git/sequencer/todo": "git-state", ".git/info/exclude": "git-state",
      ".git/index.lock": "noise", ".git/refs/heads/main.lock": "noise", ".git/objects/ab/cdef": "noise", ".git/logs/HEAD": "noise", ".git/fsmonitor--daemon/cookies/x": "noise", ".git/hooks/pre-commit": "noise",
      "src/app.ts": "tree", "README.md": "tree", "docs/design/object-model.md": "tree", ".gitignore": "tree", ".pi/goals/active_goal.md": "tree",
      "node_modules/lit/index.js": "noise", "packages/a/node_modules/x.js": "noise", ".pi/tasks/abc.output": "noise", ".pi/delegate/run.jsonl": "noise", ".watchman-cookie-host-1": "noise",
      ".git/worktrees/wt/logs/HEAD": "noise", ".git/worktrees/wt/index": "noise", "vendor/lib/.git/objects/ab/cd": "noise", "vendor/lib/.git/HEAD": "noise", ".git": "noise", ".git\\refs\\heads\\main": "git-state",
      "sub/.pi/tasks/x.output": "noise", ".pi/sessions/s.jsonl": "noise", "apps/web/.pi/sessions/s.jsonl": "noise", ".pi/settings.json": "tree",
      ".git/modules/lib/HEAD": "git-state", ".git/modules/lib/refs/heads/main": "git-state", ".git/modules/lib/objects/ab/cd": "noise", ".git/modules/lib/index.lock": "noise", ".git/modules/lib/modules/inner/index": "git-state",
      "": "tree", "undefined": "tree",
    });
  });
});
