import { describe, expect, it, vi } from "vitest";
import { noPanelTerminal } from "../terminalSessionsTestSupport.js";
import type { JsonValue, WorkspacePanelContext } from "@gang-of-beads/pi-web/plugin-api";
import { GIT_COMMIT_DIFF_OPERATION, GIT_DIFF_OPERATION, GIT_HISTORY_OPERATION } from "./browser/git-contract.js";
import { GitUiController } from "./browser/git-panel.js";
import type { GitDiffRoute } from "./browser/gitRoute.js";

const route: GitDiffRoute = {
  matches: () => false,
  read: () => ({ mode: "changes", diffPath: undefined, commitId: undefined, expanded: false }),
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

function context(id: string, request: (operation: string, input: JsonValue) => Promise<JsonValue>, fullscreen = false): WorkspacePanelContext {
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
    host: { requestRender() { /* no-op */ }, workspacePanelFullscreen: () => fullscreen, setWorkspacePanelFullscreen() { /* no-op */ } },
    prompt: {
      insertText() { /* no-op */ },
      getText: () => "",
      getSelection: () => null,
    },
    terminal: noPanelTerminal(),
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

  it("limits visible review loading to two files while prioritizing queued work", async () => {
    const controller = new GitUiController("git", route);
    const pending: { input: JsonValue; resolve: (value: JsonValue) => void }[] = [];
    const current = context("first", (operation, input) => {
      if (operation !== GIT_DIFF_OPERATION) throw new Error(`Unexpected operation: ${operation}`);
      return new Promise<JsonValue>((resolve) => { pending.push({ input, resolve }); });
    }, true);
    controller.state(current);
    controller.reviewSectionVisibilityChanged(current, "first.ts", true);
    controller.reviewSectionVisibilityChanged(current, "second.ts", true);
    controller.reviewSectionVisibilityChanged(current, "third.ts", true);

    expect(pending.map(({ input }) => input)).toEqual([
      { path: "first.ts" }, { path: "first.ts", staged: true },
      { path: "second.ts" }, { path: "second.ts", staged: true },
    ]);

    for (const request of pending.slice(0, 2)) {
      const staged = typeof request.input === "object" && request.input !== null && "staged" in request.input && request.input["staged"] === true;
      request.resolve({ path: "first.ts", staged, hash: staged ? "s" : "u", diff: "", truncated: false });
    }
    await vi.waitFor(() => { expect(pending).toHaveLength(6); });

    expect(pending.slice(4).map(({ input }) => input)).toEqual([
      { path: "third.ts" }, { path: "third.ts", staged: true },
    ]);
  });

  it("removes offscreen queued review work without canceling the selected anchor", () => {
    const controller = new GitUiController("git", route);
    const current = context("first", () => new Promise<JsonValue>(() => { /* stays in flight */ }), true);
    controller.state(current);
    controller.reviewSectionVisibilityChanged(current, "loading-1.ts", true);
    controller.reviewSectionVisibilityChanged(current, "loading-2.ts", true);
    controller.reviewSectionVisibilityChanged(current, "queued.ts", true);
    controller.reviewSectionVisibilityChanged(current, "queued.ts", false);
    controller.reviewSectionVisibilityChanged(current, "anchor.ts", true);
    controller.selectDiff(current, "anchor.ts");
    controller.reviewSectionVisibilityChanged(current, "anchor.ts", false);

    expect(controller.state(current).reviewQueue.map(({ path }) => path)).toEqual(["anchor.ts"]);
    expect(controller.state(current).reviewDiffs.get("queued.ts")?.status).toBe("unrequested");
    expect(controller.state(current).reviewDiffs.get("anchor.ts")?.status).toBe("queued");
  });

  it("restores a different commit diff on browser history navigation", async () => {
    const first = { ...commit, id: "1".repeat(40) };
    const second = { ...commit, id: "2".repeat(40) };
    let routedCommitId: string | undefined = first.id;
    const navigableRoute: GitDiffRoute = {
      matches: () => true,
      read: () => ({ mode: "history", diffPath: undefined, commitId: routedCommitId, expanded: false }),
      write: () => { /* no-op */ },
    };
    const controller = new GitUiController("git", navigableRoute);
    const commitDiffIds: string[] = [];
    const current = context("first", (operation, input) => {
      if (operation === GIT_HISTORY_OPERATION) return Promise.resolve({ unborn: false, commits: [first, second], truncated: false });
      if (operation === GIT_COMMIT_DIFF_OPERATION) {
        const id = typeof input === "object" && input !== null && "id" in input ? input["id"] : undefined;
        if (typeof id !== "string") throw new Error("Expected commit id");
        commitDiffIds.push(id);
        return Promise.resolve({ commit: id === first.id ? first : second, combined: false, diff: "", truncated: false });
      }
      return Promise.resolve({ isGitRepo: true, branch: "main", files: [], submodules: [], hash: "status" });
    });

    controller.connect(current);
    await vi.waitFor(() => { expect(commitDiffIds).toContain(first.id); });
    routedCommitId = second.id;
    controller.handlePopState(current);
    await vi.waitFor(() => { expect(controller.state(current).selectedCommitDiff?.response.commit.id).toBe(second.id); });

    expect(commitDiffIds).toContain(second.id);
    expect(controller.state(current).selectedCommitId).toBe(second.id);
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
