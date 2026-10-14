import { describe, expect, it } from "vitest";
import type { Workspace } from "./api";
import { composerCwd, initialAppState } from "./appState";
import { oldSession } from "./controllers/sessionController.testSupport";

const workspace: Workspace = { id: "ws-1", projectId: "p1", path: "/repo", label: "repo", isMain: true, effectiveConfig: {} };

describe("the composer's working directory", () => {
  const session = { ...oldSession, cwd: "/repo/session-dir" };

  /** A session opened in a subdirectory of the selected workspace is found by its own directory, not the workspace's. */
  it("names the session's own directory, even inside a selected workspace", () => {
    const state = { ...initialAppState(), selectedSession: session, selectedWorkspace: workspace };
    expect(composerCwd(state)).toBe("/repo/session-dir");
  });

  it("falls back to the selected workspace while the session has no directory", () => {
    const state = { ...initialAppState(), selectedSession: { ...session, cwd: "" }, selectedWorkspace: workspace };
    expect(composerCwd(state)).toBe("/repo");
  });

  it("has nothing to offer when neither is known", () => {
    expect(composerCwd(initialAppState())).toBeUndefined();
  });
});
