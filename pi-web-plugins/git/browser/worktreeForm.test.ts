import { describe, expect, it } from "vitest";
import { defaultWorktreePath, worktreeFormVerdict } from "./worktreeForm.js";

describe("defaultWorktreePath", () => {
  it("puts the worktree beside the repository, named after it and the branch", () => {
    expect(defaultWorktreePath("/srv/dev/pi-web", "feature")).toBe("/srv/dev/pi-web-feature");
    expect(defaultWorktreePath("/srv/dev/pi-web/", "feat/login v2")).toBe("/srv/dev/pi-web-feat-login-v2");
    expect(defaultWorktreePath("/repo", "x")).toBe("/repo-x");
    expect(defaultWorktreePath("/srv/dev/pi-web", "")).toBe("/srv/dev/pi-web");
  });

  it("keeps a Windows repository on its own separator", () => {
    expect(defaultWorktreePath("C:\\code\\repo", "fix")).toBe("C:\\code\\repo-fix");
  });
});

describe("worktreeFormVerdict", () => {
  it("enumerates every verdict", () => {
    expect(worktreeFormVerdict({ branch: " ", path: "/x" })).toEqual({ kind: "missing-branch" });
    expect(worktreeFormVerdict({ branch: "b", path: "" })).toEqual({ kind: "missing-path" });
    expect(worktreeFormVerdict({ branch: "b", path: "relative/x" })).toEqual({ kind: "relative-path" });
    expect(worktreeFormVerdict({ branch: "b", path: "/abs/x" })).toEqual({ kind: "ready" });
    expect(worktreeFormVerdict({ branch: "b", path: "D:\\abs\\x" })).toEqual({ kind: "ready" });
  });
});
