import { describe, expect, it, vi } from "vitest";
import type { SessionStatus } from "../../../shared/apiTypes";
import { WorkspaceActivityService } from "./workspaceActivityService";

function status(patch: Partial<SessionStatus> = {}): SessionStatus {
  return {
    sessionId: "s1",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    ...patch,
  };
}

/** The service under test plus the change notifications it reported. */
function activityRecord() {
  const onChanged = vi.fn();
  return { service: new WorkspaceActivityService(onChanged), onChanged };
}

describe("WorkspaceActivityService", () => {
  it("records session activity by cwd and reports projection changes", () => {
    const { service, onChanged } = activityRecord();

    service.applySessionStatus("/repo", status({ isStreaming: true }));

    expect(service.snapshot().workspaces).toMatchObject([{ cwd: "/repo", hasSessionActivity: true, hasTerminalActivity: false }]);
    expect(onChanged).toHaveBeenCalledTimes(1);

    service.applySessionStatus("/repo", status({ isStreaming: false }));

    expect(service.snapshot().workspaces).toEqual([]);
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it("does not report a workspace active for a session that is only starting up", () => {
    const { service, onChanged } = activityRecord();

    // Startup progress names a phase the daemon is inside; it is not work, so the
    // workspace (and the project indicators and remote machines that read it)
    // must not be reported as busy because of it.
    service.applySessionActivity("/repo", { sessionId: "s1", phase: "active", label: "Opening session", detail: "Starting the Pi session", at: "now", startup: true });

    expect(service.snapshot().workspaces).toEqual([]);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("does not recompute machine status for unchanged heartbeat contributions", () => {
    const { service, onChanged } = activityRecord();
    const active = { sessionId: "s1", phase: "active" as const, label: "running tool", at: "now" };
    service.applySessionActivity("/repo", active);
    onChanged.mockClear();

    service.applySessionStatus("/repo", status({ isStreaming: true, cost: 1 }));
    service.applySessionActivity("/repo", { ...active, at: "later", detail: "still running" });
    service.applySessionStatus("/repo", status({ isStreaming: true, cost: 2 }));

    expect(service.snapshot().workspaces).toEqual([
      { cwd: "/repo", hasSessionActivity: true, hasTerminalActivity: false },
    ]);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("reports one projection change when active work moves to another cwd", () => {
    const { service, onChanged } = activityRecord();
    service.applySessionStatus("/repo-a", status({ isStreaming: true }));
    onChanged.mockClear();

    service.applySessionStatus("/repo-b", status({ isStreaming: true }));

    expect(service.snapshot().workspaces).toEqual([
      { cwd: "/repo-b", hasSessionActivity: true, hasTerminalActivity: false },
    ]);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("clears stale active activity when an idle status arrives", () => {
    const { service } = activityRecord();

    service.applySessionActivity("/repo", { sessionId: "s1", phase: "active", label: "running tool", detail: "read", at: "now" });
    service.applySessionStatus("/repo", status({ isStreaming: false }));

    expect(service.snapshot().workspaces).toEqual([]);
  });

  it("reports a change when removing an already-pruned session with a cwd", () => {
    const { service, onChanged } = activityRecord();

    service.removeSession("missing-session", "/repo");

    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("reconciles stale session activity for a workspace", () => {
    const { service, onChanged } = activityRecord();

    service.applySessionActivity("/repo", { sessionId: "s1", phase: "active", label: "running tool", at: "now" });
    service.applySessionActivity("/repo", { sessionId: "s2", phase: "active", label: "running tool", at: "now" });
    service.applySessionActivity("/other", { sessionId: "s3", phase: "active", label: "running tool", at: "now" });
    onChanged.mockClear();

    service.reconcileSessionActivity("/repo", ["s2"]);

    expect(service.snapshot().workspaces).toMatchObject([
      { cwd: "/other", hasSessionActivity: true, hasTerminalActivity: false },
      { cwd: "/repo", hasSessionActivity: true, hasTerminalActivity: false },
    ]);

    service.reconcileSessionActivity("/repo", []);

    expect(service.snapshot().workspaces).toMatchObject([{ cwd: "/other", hasSessionActivity: true, hasTerminalActivity: false }]);
    expect(onChanged).toHaveBeenCalled();
  });

  it("combines sessions and terminals and clears closed terminals", () => {
    const { service, onChanged } = activityRecord();

    service.applySessionActivity("/repo", { sessionId: "s1", phase: "active", label: "running tool", detail: "read", at: "now" });
    service.updateTerminal({ id: "t1", cwd: "/repo", exited: false });

    expect(service.snapshot().workspaces).toMatchObject([{ cwd: "/repo", hasSessionActivity: true, hasTerminalActivity: true }]);

    service.removeSession("s1");
    service.updateTerminal({ id: "t1", cwd: "/repo", exited: true });

    expect(service.snapshot().workspaces).toEqual([]);
    expect(onChanged).toHaveBeenCalled();
  });

  it("does not report repeated terminal snapshots at the same cwd", () => {
    const { service, onChanged } = activityRecord();
    service.updateTerminal({ id: "t1", cwd: "/repo", exited: false });
    onChanged.mockClear();

    service.updateTerminal({ id: "t1", cwd: "/repo", exited: false });

    expect(onChanged).not.toHaveBeenCalled();
  });

  it("aggregates multiple activity sources into one sorted workspace snapshot", () => {
    const service = new WorkspaceActivityService();
    service.applySessionStatus("/z-repo", status({ sessionId: "s1", isStreaming: true }));
    service.applySessionStatus("/a-repo", status({ sessionId: "s2", isStreaming: true }));
    service.updateTerminal({ id: "t1", cwd: "/z-repo", exited: false });
    service.updateTerminal({ id: "t2", cwd: "/a-repo", exited: false });

    expect(service.snapshot().workspaces).toEqual([
      { cwd: "/a-repo", hasSessionActivity: true, hasTerminalActivity: true },
      { cwd: "/z-repo", hasSessionActivity: true, hasTerminalActivity: true },
    ]);
  });

  it("records activity without a listener, so a store built for a test still works", () => {
    const service = new WorkspaceActivityService();

    service.updateTerminal({ id: "t1", cwd: "/repo", exited: false });

    expect(service.snapshot().workspaces).toMatchObject([{ cwd: "/repo", hasTerminalActivity: true }]);
  });
});
