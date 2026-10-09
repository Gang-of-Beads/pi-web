import { machineTerminalSocket, terminalsApi } from "../api";
import type { MachineTerminalSessions } from "./types";

/**
 * The host's side of the machine terminal capability handed to global pages: shells in the
 * machine's home folder (docs/design/go-to-scopes.md). The routes and the socket are the host's
 * business; the machine every call belongs to is bound here once.
 */
export function machineTerminalSessions(machineId: string): MachineTerminalSessions {
  return {
    list: () => terminalsApi.machineTerminals(machineId),
    start: (options) => terminalsApi.startMachineTerminal(options, machineId),
    close: async (terminalId) => { await terminalsApi.closeMachineTerminal(terminalId, machineId); },
    closeAll: async () => { await terminalsApi.closeMachineTerminals(machineId); },
    continue: (terminalId) => terminalsApi.continueMachineTerminal(terminalId, machineId),
    rename: (terminalId, name) => terminalsApi.renameMachineTerminal(terminalId, name, machineId),
    connect: (terminalId, initialSize) => machineTerminalSocket(terminalId, initialSize, machineId),
  };
}

/** How long a new shell's stream may take to open. */
const TYPE_COMMAND_OPEN_MS = 10_000;
/** The quiet after the shell's output that counts as its prompt being drawn. */
const SHELL_SETTLED_MS = 300;
/** The longest wait for that quiet: a shell that never goes quiet is typed into anyway. */
const SHELL_READY_CAP_MS = 5_000;

/**
 * Type one command line into a new terminal and let go of the stream. Machine terminals keep no
 * command runs (their records are project-scoped), so a global page that runs a command does what a
 * person would: open a shell and type it. Not before the shell has drawn its prompt: zsh on 8505
 * threw away a line typed while it started, so the line waits until the shell's output has gone
 * quiet for SHELL_SETTLED_MS (at most SHELL_READY_CAP_MS after the stream opens).
 */
export function typeCommand(socket: WebSocket, command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled: ReturnType<typeof setTimeout> | undefined;
    let cap: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    const stop = (): void => {
      done = true;
      clearTimeout(opening);
      clearTimeout(settled);
      clearTimeout(cap);
    };
    const type = (): void => {
      if (done) return;
      stop();
      socket.send(JSON.stringify({ type: "input", data: `${command}\r` }));
      socket.close();
      resolve();
    };
    const fail = (error: Error): void => {
      if (done) return;
      stop();
      socket.close();
      reject(error);
    };
    const opening = setTimeout(() => { fail(new Error("The terminal did not open in time")); }, TYPE_COMMAND_OPEN_MS);
    socket.addEventListener("open", () => {
      clearTimeout(opening);
      cap = setTimeout(type, SHELL_READY_CAP_MS);
    }, { once: true });
    socket.addEventListener("message", () => {
      clearTimeout(settled);
      settled = setTimeout(type, SHELL_SETTLED_MS);
    });
    socket.addEventListener("error", () => { fail(new Error("The terminal's stream failed")); }, { once: true });
    socket.addEventListener("close", () => { fail(new Error("The terminal closed before the command was typed")); }, { once: true });
  });
}
