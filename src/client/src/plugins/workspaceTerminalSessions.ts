import { terminalSocket, terminalsApi, type TerminalInfo, type Workspace } from "../api";
import type { WorkspaceTerminalSessions } from "./types";

/**
 * The host's side of the terminal capability handed to workspace panels.
 *
 * A panel that draws terminals should not know how a terminal is reached: the
 * routes and the socket are the host's business, and the scope every call
 * belongs to - this machine, this project, this workspace - is bound here
 * once rather than passed around and eventually passed wrong.
 */
export function workspaceTerminalSessions(workspace: Workspace, machineId: string): WorkspaceTerminalSessions {
  const { projectId, id } = workspace;
  return {
    list: (): Promise<TerminalInfo[]> => terminalsApi.terminals(projectId, id, machineId),
    start: (options) => terminalsApi.startTerminal(projectId, id, options, machineId),
    close: async (terminalId) => { await terminalsApi.closeTerminal(projectId, id, terminalId, machineId); },
    closeAll: async () => { await terminalsApi.closeWorkspaceTerminals(projectId, id, machineId); },
    continue: (terminalId) => terminalsApi.continueTerminal(projectId, id, terminalId, machineId),
    connect: (terminalId, initialSize) => terminalSocket(projectId, id, terminalId, initialSize, machineId),
    listCommandRuns: () => terminalsApi.listCommandRuns({ projectId, workspaceId: id }, machineId),
    cancelCommandRun: (runId) => terminalsApi.cancelCommandRun(runId, machineId),
  };
}
