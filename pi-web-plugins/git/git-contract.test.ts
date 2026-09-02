import { describe, expect, it } from "vitest";
import {
  parseGitCommitDiffResponse,
  parseGitDiffResponse,
  parseGitHistoryResponse,
  parseGitStatusResponse,
} from "./browser/git-contract.js";

describe("Git browser backend contract", () => {
  it("parses status, submodule pointers, and diffs from JSON-only backend results", () => {
    const status = parseGitStatusResponse({
      isGitRepo: true,
      hash: "status-hash",
      branch: "main",
      files: [
        { path: "HARL", index: "unmodified", workingTree: "modified", submoduleFromCommit: "1111111", submoduleToCommit: "2222222" },
        { path: "HARL/inner.txt", index: "modified", workingTree: "modified" },
      ],
      submodules: ["HARL"],
    });
    const diff = parseGitDiffResponse({ path: "HARL/inner.txt", staged: false, hash: "diff-hash", diff: "@@ -1 +1 @@", truncated: false });

    expect(status.submodules).toEqual(["HARL"]);
    expect(status.files[0]).toMatchObject({ submoduleFromCommit: "1111111", submoduleToCommit: "2222222" });
    expect(diff).toMatchObject({ path: "HARL/inner.txt", staged: false, hash: "diff-hash" });
  });

  it("parses history and selected-commit diff JSON results", () => {
    const commit = {
      id: "a".repeat(40),
      parentIds: ["b".repeat(40)],
      authorName: "A name",
      authorEmail: "a@example.test",
      authoredAt: "2026-09-01T12:34:56+00:00",
      subject: "subject with a separator | and newline\nstill safe",
    };
    const history = parseGitHistoryResponse({ unborn: false, commits: [commit], nextCursor: "opaque", truncated: false });
    const diff = parseGitCommitDiffResponse({ commit, combined: false, diff: "diff --git a/a b/a", truncated: false });

    expect(history.commits[0]).toEqual(commit);
    expect(history.nextCursor).toBe("opaque");
    expect(diff).toMatchObject({ commit, combined: false });
  });

  it("rejects malformed history and commit responses", () => {
    expect(() => parseGitHistoryResponse({ unborn: true, commits: [{ id: "a".repeat(40) }], truncated: false }))
      .toThrow("Expected string array field: parentIds");
    expect(() => parseGitHistoryResponse({ unborn: true, commits: [], nextCursor: "not-allowed", truncated: false }))
      .toThrow("must not contain commits or a cursor");
    expect(() => parseGitCommitDiffResponse({ commit: { id: "short" }, combined: false, diff: "", truncated: false }))
      .toThrow("Git commit summary id must be a complete object ID");
  });

  it("keeps the legacy missing-submodules response compatible while rejecting malformed provider data", () => {
    expect(parseGitStatusResponse({ isGitRepo: true, hash: "h", files: [] }).submodules).toEqual([]);
    expect(() => parseGitStatusResponse({ isGitRepo: true, hash: "h", files: [{ path: "a", index: "weird", workingTree: "modified" }] }))
      .toThrow("Invalid Git file state");
    expect(() => parseGitDiffResponse({ staged: false, hash: "h", diff: "" }))
      .toThrow("Expected boolean field: truncated");
  });
});
