import { describe, expect, it } from "vitest";
import type { JsonValue, WorkspacePanelContext } from "@gang-of-beads/pi-web/plugin-api";
import { GIT_COMMIT_DIFF_OPERATION, GIT_HISTORY_OPERATION } from "./browser/git-contract.js";
import { GitUiController } from "./browser/git-panel.js";
import type { GitDiffRoute } from "./browser/gitRoute.js";

const route: GitDiffRoute = {
  matches: () => false,
  read: () => undefined,
  write: () => { /* no-op */ },
};
const commit = {
  id: "a".repeat(40),
  parentIds: ["b".repeat(40)],
  authorName: "Test Author",
  authorEmail: "author@example.test",
  authoredAt: "2026-09-01T12:00:00+00:00",
  subject: "Test commit",
};

function context(id: string, request: (operation: string, input: JsonValue) => Promise<JsonValue>): WorkspacePanelContext {
  return {
    machine: { id: "local", name: "Local", kind: "local" },
    workspace: { id, projectId: "project", path: "/workspace", label: id, isMain: false, provider: { pluginId: "git", capabilities: { request: true, remove: false } } },
    files: {
      readFile: () => Promise.reject(new Error("Not used by this test")),
      listFiles: () => Promise.reject(new Error("Not used by this test")),
      writeFile: () => Promise.reject(new Error("Not used by this test")),
      deleteFile: () => Promise.reject(new Error("Not used by this test")),
      moveFile: () => Promise.reject(new Error("Not used by this test")),
    },
    backend: { request },
    host: { requestRender() { /* no-op */ } },
    prompt: {
      insertText() { /* no-op */ },
      getText: () => "",
      getSelection: () => null,
    },
    terminal: {
      open() { /* no-op */ },
      runCommand: () => Promise.reject(new Error("Not used by this test")),
    },
  };
}

describe("Git history panel controller", () => {
  it("keeps Changes layout state and History data independent for each workspace", async () => {
    const controller = new GitUiController("git", route);
    const requests: string[] = [];
    const request = (operation: string): Promise<JsonValue> => {
      requests.push(operation);
      return Promise.resolve({ unborn: false, commits: [commit], truncated: false });
    };
    const first = context("first", request);
    const second = context("second", request);

    controller.setView(first, "tree");
    controller.setMode(first, "history");
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.state(first).mode).toBe("history");
    expect(controller.state(first).history?.commits).toEqual([commit]);
    expect(controller.currentView()).toBe("tree");
    expect(controller.state(second).mode).toBe("changes");
    expect(controller.state(second).history).toBeUndefined();
    expect(requests).toEqual([GIT_HISTORY_OPERATION]);
  });

  it("ignores a selected commit diff that resolves after the selection changes", async () => {
    const controller = new GitUiController("git", route);
    let resolveFirst!: (value: JsonValue) => void;
    const firstDiff = new Promise<JsonValue>((resolve) => { resolveFirst = resolve; });
    const selected = { ...commit, id: "c".repeat(40) };
    let commitDiffCalls = 0;
    const current = context("first", (operation) => {
      if (operation === GIT_HISTORY_OPERATION) return Promise.resolve({ unborn: false, commits: [commit, selected], truncated: false });
      if (operation === GIT_COMMIT_DIFF_OPERATION) {
        commitDiffCalls += 1;
        return commitDiffCalls === 1 ? firstDiff : new Promise<JsonValue>(() => { /* remains pending */ });
      }
      throw new Error(`Unexpected operation: ${operation}`);
    });

    controller.setMode(current, "history");
    await Promise.resolve();
    await Promise.resolve();
    controller.selectCommit(current, commit);
    controller.selectCommit(current, selected);
    resolveFirst({ commit, combined: false, diff: "", truncated: false });
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.state(current).selectedCommitId).toBe(selected.id);
    expect(controller.state(current).selectedCommitDiff).toBeUndefined();
    expect(controller.state(current).commitDiffLoading).toBe(true);
  });
});
