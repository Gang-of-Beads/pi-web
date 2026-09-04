// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalPanel } from "./TerminalPanel.js";
import type { TerminalCommandRun, TerminalInfo, Workspace, WorkspaceTerminalSessions } from "@gang-of-beads/pi-web/plugin-api";

afterEach(() => { document.body.replaceChildren(); });

const workspace: Workspace = { id: "w1", projectId: "p1", path: "/repo", label: "repo", isMain: true };

function terminal(id: string): TerminalInfo {
  return { id, cwd: "/repo", name: id, createdAt: "now", exited: false };
}

function sessions(patch: Partial<WorkspaceTerminalSessions> = {}): WorkspaceTerminalSessions {
  const absent = (): Promise<never> => Promise.reject(new Error("not used"));
  return {
    list: () => Promise.resolve([terminal("t1")]),
    start: () => Promise.resolve(terminal("t2")),
    close: () => Promise.resolve(),
    closeAll: () => Promise.resolve(),
    continue: () => Promise.resolve(terminal("t1")),
    connect: () => { throw new Error("not used"); },
    listCommandRuns: (): Promise<TerminalCommandRun[]> => Promise.resolve([]),
    cancelCommandRun: absent,
    ...patch,
  };
}

async function mount(capability: WorkspaceTerminalSessions): Promise<TerminalPanel> {
  const panel = new TerminalPanel();
  panel.workspace = workspace;
  panel.machineId = "remote-1";
  panel.sessions = capability;
  document.body.append(panel);
  await panel.updateComplete;
  Reflect.set(panel, "visible", true);
  panel.requestUpdate();
  await panel.updateComplete;
  return panel;
}

describe("the terminal panel works through the capability it was given", () => {
  it("lists terminals and command runs through the capability, not the routes", async () => {
    const list = vi.fn(() => Promise.resolve([terminal("t1")]));
    const listCommandRuns = vi.fn(() => Promise.resolve([]));

    await mount(sessions({ list, listCommandRuns }));
    await vi.waitFor(() => {
      if (list.mock.calls.length === 0) throw new Error("the panel has not listed terminals yet");
    });

    expect(list).toHaveBeenCalled();
    expect(listCommandRuns).toHaveBeenCalled();
  });

  it("reports a refused listing instead of showing an empty terminal list as truth", async () => {
    const panel = await mount(sessions({ list: () => Promise.reject(new Error("daemon refused")) }));

    await vi.waitFor(() => {
      if (!(panel.shadowRoot?.textContent ?? "").includes("daemon refused")) throw new Error("no failure reported yet");
    });

    expect(panel.shadowRoot?.textContent).toContain("daemon refused");
  });
});
