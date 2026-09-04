import { describe, expect, it, vi } from "vitest";

const calls: { name: string; args: unknown[] }[] = [];

vi.mock("../api", () => ({
  terminalsApi: {
    terminals: (...args: unknown[]) => { calls.push({ name: "terminals", args }); return Promise.resolve([]); },
    startTerminal: (...args: unknown[]) => { calls.push({ name: "startTerminal", args }); return Promise.resolve({ id: "t1" }); },
    closeTerminal: (...args: unknown[]) => { calls.push({ name: "closeTerminal", args }); return Promise.resolve({ closed: 1 }); },
    closeWorkspaceTerminals: (...args: unknown[]) => { calls.push({ name: "closeWorkspaceTerminals", args }); return Promise.resolve({ closed: 2 }); },
    continueTerminal: (...args: unknown[]) => { calls.push({ name: "continueTerminal", args }); return Promise.resolve({ id: "t1" }); },
  },
  terminalSocket: (...args: unknown[]) => { calls.push({ name: "terminalSocket", args }); return { kind: "socket" }; },
}));

import type { Workspace } from "../api";

const { workspaceTerminalSessions } = await import("./workspaceTerminalSessions");

const workspace: Workspace = { id: "w1", projectId: "p1", path: "/repo", label: "repo", isMain: true, effectiveConfig: {} };

function sessions() {
  calls.length = 0;
  return workspaceTerminalSessions(workspace, "remote-1");
}

describe("the terminal capability handed to a panel", () => {
  it("binds every call to the panel's own machine, project and workspace", async () => {
    const api = sessions();

    await api.list();
    await api.start({ cols: 80, rows: 24 });
    await api.close("t1");
    await api.closeAll();
    await api.continue("t1");
    api.connect("t1", { cols: 80, rows: 24 });

    expect(calls.map((call) => call.name)).toEqual([
      "terminals",
      "startTerminal",
      "closeTerminal",
      "closeWorkspaceTerminals",
      "continueTerminal",
      "terminalSocket",
    ]);
    for (const call of calls) {
      expect(call.args).toContain("p1");
      expect(call.args).toContain("w1");
      expect(call.args).toContain("remote-1");
    }
  });

  it("does not report the daemon's close counts as a panel-visible value", async () => {
    const api = sessions();

    await expect(api.close("t1")).resolves.toBeUndefined();
    await expect(api.closeAll()).resolves.toBeUndefined();
  });
});
