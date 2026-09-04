import type { TerminalInfo } from "../api";

/**
 * Which terminal a panel shows.
 *
 * An explicit target wins; otherwise the last one this workspace used, and
 * only then the first live one. An exited terminal is a legitimate thing to
 * show when it is what was asked for, but it is never what gets chosen for
 * you.
 */
export function selectPreferredTerminal(terminals: TerminalInfo[], options?: { targetTerminalId?: string | undefined; latestTerminalId?: string | undefined }): TerminalInfo | undefined {
  const targetTerminalId = options?.targetTerminalId;
  if (targetTerminalId !== undefined && targetTerminalId !== "") return terminals.find((terminal) => terminal.id === targetTerminalId);

  const latestTerminalId = options?.latestTerminalId;
  if (latestTerminalId !== undefined && latestTerminalId !== "") {
    return terminals.find((terminal) => terminal.id === latestTerminalId) ?? terminals.find((terminal) => !terminal.exited) ?? terminals[0];
  }

  return terminals.find((terminal) => !terminal.exited) ?? terminals[0];
}

export function selectFallbackTerminal(terminals: TerminalInfo[]): TerminalInfo | undefined {
  return terminals.find((terminal) => !terminal.exited) ?? terminals[0];
}
