import type { TerminalCommandRun, TerminalCommandRunHandle, TerminalInfo, WorkspacePanelTerminal, WorkspaceTerminalSessions } from "@gang-of-beads/pi-web/plugin-api";

/** A terminal capability for plugin tests that only need a panel context to be complete. */
export function noTerminalSessions(): WorkspaceTerminalSessions {
  const absent = (): Promise<never> => Promise.reject(new Error("No terminal capability in this test"));
  return {
    list: (): Promise<TerminalInfo[]> => Promise.resolve([]),
    start: absent,
    close: absent,
    closeAll: absent,
    continue: absent,
    connect: () => { throw new Error("No terminal capability in this test"); },
    listCommandRuns: (): Promise<TerminalCommandRun[]> => Promise.resolve([]),
    cancelCommandRun: absent,
  };
}

/** A complete panel terminal capability for tests that do not exercise it. */
export function noPanelTerminal(): WorkspacePanelTerminal {
  return {
    open: () => undefined,
    runCommand: (): Promise<TerminalCommandRunHandle> => Promise.reject(new Error("No terminal capability in this test")),
    sessions: noTerminalSessions(),
    activeCount: 0,
    selectedId: undefined,
    autoStart: false,
    select: () => undefined,
  };
}
