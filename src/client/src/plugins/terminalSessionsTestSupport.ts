import type { TerminalInfo } from "../api";
import type { TerminalCommandRunHandle } from "../api";
import type { WorkspacePanelTerminal, WorkspaceTerminalSessions } from "./types";

/** A terminal capability for tests that only need a panel context to be complete. */
export function noTerminalSessions(): WorkspaceTerminalSessions {
  const absent = (): Promise<never> => Promise.reject(new Error("No terminal capability in this test"));
  return {
    list: () => Promise.resolve<TerminalInfo[]>([]),
    start: absent,
    close: absent,
    closeAll: absent,
    continue: absent,
    rename: absent,
    connect: () => { throw new Error("No terminal capability in this test"); },
    listCommandRuns: () => Promise.resolve([]),
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
