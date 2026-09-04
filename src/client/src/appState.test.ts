import { describe, expect, it } from "vitest";
import type { Workspace } from "./api";
import { composerCwd, initialAppState } from "./appState";
import { oldSession } from "./controllers/sessionController.testSupport";

const workspace: Workspace = { id: "ws-1", projectId: "p1", path: "/repo", label: "repo", isMain: true, effectiveConfig: {} };

describe("the composer's working directory", () => {
  const session = { ...oldSession, cwd: "/repo/session-dir" };

  it("prefers the selected workspace path", () => {
    const state = { ...initialAppState(), selectedSession: session, selectedWorkspace: workspace };
    expect(composerCwd(state)).toBe("/repo");
  });

  /**
   * Slash commands are looked up per directory and the lookup is guarded on a
   * non-empty cwd. A session selected before its workspace listing landed used
   * to hand the composer nothing, so typing "/" silently offered no commands.
   */
  it("falls back to the session's own directory when no workspace is resolved", () => {
    const state = { ...initialAppState(), selectedSession: session };
    expect(composerCwd(state)).toBe("/repo/session-dir");
  });

  it("has nothing to offer when neither is known", () => {
    expect(composerCwd(initialAppState())).toBeUndefined();
  });
});
