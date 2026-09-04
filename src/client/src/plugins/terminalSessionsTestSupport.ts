import type { TerminalInfo } from "../api";
import type { WorkspaceTerminalSessions } from "./types";

/** A terminal capability for tests that only need a panel context to be complete. */
export function noTerminalSessions(): WorkspaceTerminalSessions {
  const absent = (): Promise<never> => Promise.reject(new Error("No terminal capability in this test"));
  return {
    list: () => Promise.resolve<TerminalInfo[]>([]),
    start: absent,
    close: absent,
    closeAll: absent,
    continue: absent,
    connect: () => { throw new Error("No terminal capability in this test"); },
  };
}
