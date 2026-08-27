import { describe, expect, it } from "vitest";
import { refreshMayReplaceSelection } from "./sessionRefreshScope";

describe("what a workspace refresh may do to the session you are reading", () => {
  /**
   * Refreshing a workspace's session list replaced the selection when the
   * selected session was not in it - picking another session in that workspace,
   * or clearing the selection entirely. That is right when the session really
   * was removed from the workspace being refreshed.
   *
   * But a session can be open from another workspace: the switcher spans the
   * whole machine, while this list is one workspace. A realtime reconnect then
   * refreshed the old workspace, failed to find the session being read, and
   * moved the reader into a different conversation. Measured on the running
   * instance: selected went from a session under one workspace to undefined,
   * while the address bar still pointed at the other.
   *
   * Someone reading one conversation and typing into another is how a message
   * ends up in the wrong place.
   */
  it("leaves the selection alone when the session belongs elsewhere", () => {
    expect(refreshMayReplaceSelection({ refreshedWorkspacePath: "/a", selectedSessionCwd: "/b" })).toBe(false);
  });

  it("may replace it when the session really was in the refreshed workspace", () => {
    expect(refreshMayReplaceSelection({ refreshedWorkspacePath: "/a", selectedSessionCwd: "/a" })).toBe(true);
  });

  /**
   * An unknown cwd is not evidence that the session left, so it is not grounds
   * for moving the reader.
   */
  it("leaves the selection alone when the session's own place is unknown", () => {
    expect(refreshMayReplaceSelection({ refreshedWorkspacePath: "/a", selectedSessionCwd: undefined })).toBe(false);
  });
});
