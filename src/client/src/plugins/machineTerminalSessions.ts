import { machineTerminalSocket, terminalsApi } from "../api";
import { HttpError } from "../api/http";
import { PI_WEB_CAPABILITIES, supportsPiWebCapability, type PiWebCapability } from "../../../shared/capabilities";
import { SHELL_READY_CAP_MS, SHELL_SETTLED_MS } from "../../../shared/terminalStartCommand";
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

/** A global page's command for a new home-folder shell: the shell's name and the line it runs. */
export interface NewTerminalCommand {
  title: string;
  command: string;
}

/** How this page's typing ended; every outcome but `typed` leaves the command unrun. */
type TypeCommandOutcome = "typed" | "open-timeout" | "stream-failed" | "closed";

/** Why this page could not type a command into a shell it had started. */
export type UntypedCommandOutcome = Exclude<TypeCommandOutcome, "typed">;

/** The reason a caller's error message gives for each untyped outcome, in reader words. */
const UNTYPED_REASON: Readonly<Record<UntypedCommandOutcome, string>> = {
  "open-timeout": "the terminal did not open in time for this page to type it",
  "stream-failed": "the stream to the terminal failed before this page could type it",
  closed: "the terminal closed before this page could type it",
};

/**
 * What the reader is told about a command that did not run as asked. A start the machine refused
 * or did not answer is a line in the app row. A command this page could not type is its own
 * dialog, because the reader needs the command itself to run it (owner, 2026-10-21): the app row
 * carries no button (owner, 2026-10-13), and a copy key belongs beside the command.
 */
export type RunInNewTerminalReport =
  | { readonly kind: "row"; readonly text: string }
  | { readonly kind: "untyped"; readonly outcome: UntypedCommandOutcome; readonly input: NewTerminalCommand; readonly terminalId: string };

/** A run that did not go as asked, with what to tell the reader. */
export class RunInNewTerminalFailure extends Error {
  constructor(readonly report: RunInNewTerminalReport, options?: { cause: unknown }) {
    super(report.kind === "row" ? report.text : `${report.input.title} did not run: ${UNTYPED_REASON[report.outcome]}`, options);
    this.name = "RunInNewTerminalFailure";
  }
}

/**
 * Who types a new shell's command. A session daemon that advertises `terminals.start-command` types
 * it itself once the shell has settled, so no stream from this page is involved (owner report,
 * 2026-10-21: an update over a slow phone link lost its command when the page's second stream to the
 * shell did not open in 10 s). An older daemon, or one whose runtime this page could not read,
 * leaves it to this page.
 */
export type StartCommandTypist = "daemon" | "page";

export function startCommandTypist(runtime: { capabilities?: readonly PiWebCapability[] } | undefined): StartCommandTypist {
  return supportsPiWebCapability(runtime, PI_WEB_CAPABILITIES.terminalStartCommand) ? "daemon" : "page";
}

/**
 * What a start carrying its command that threw means. Only a 4xx is a refusal: the request was
 * turned away before a shell existed. Anything else - no answer, a hop answering for the machine,
 * or a 5xx that may come after the shell was spawned - leaves the start unknown: the daemon may
 * already have made the shell and typed the command, so "did not run" would invite a second press
 * and a second run (reviews b5709bee P1-1, d3c7f62a P2-1).
 */
type DaemonStartFailure = "refused" | "unknown";

function daemonStartFailure(error: unknown): DaemonStartFailure {
  return error instanceof HttpError && error.status >= 400 && error.status < 500 ? "refused" : "unknown";
}

type OpenTerminalPage = (terminalId: string | undefined) => void;

const DAEMON_START_FAILURE: Readonly<Record<DaemonStartFailure, (input: NewTerminalCommand, reason: string, open: OpenTerminalPage) => string>> = {
  refused: (input, reason) => `${input.title} did not run: ${reason}`,
  unknown: (input, reason, open) => {
    open(undefined);
    return `${input.title} may have started (${reason}); look on the Terminal page before running it again`;
  },
};

type RunInNewTerminal = (machineId: string, input: NewTerminalCommand, open: OpenTerminalPage) => Promise<void>;

/**
 * Each typist's run. Both show the shell as soon as it exists, and throw a RunInNewTerminalFailure
 * whose report says what became of the command.
 */
const RUN_IN_NEW_TERMINAL: Readonly<Record<StartCommandTypist, RunInNewTerminal>> = {
  daemon: async (machineId, input, open) => {
    const startCommand = input.command.trim() === "" ? {} : { startCommand: input.command };
    const terminal = await terminalsApi.startMachineTerminal({ name: input.title, ...startCommand }, machineId).catch((error: unknown) => {
      throw new RunInNewTerminalFailure({ kind: "row", text: DAEMON_START_FAILURE[daemonStartFailure(error)](input, errorReason(error), open) }, { cause: error });
    });
    open(terminal.id);
  },
  page: async (machineId, input, open) => {
    const terminal = await terminalsApi.startMachineTerminal({ name: input.title }, machineId).catch((error: unknown) => {
      throw new RunInNewTerminalFailure({ kind: "row", text: `${input.title} did not run: ${errorReason(error)}` }, { cause: error });
    });
    open(terminal.id);
    const outcome = await typeCommand(machineTerminalSocket(terminal.id, undefined, machineId), input.command);
    if (outcome !== "typed") throw new RunInNewTerminalFailure({ kind: "untyped", outcome, input, terminalId: terminal.id });
  },
};

export function runInNewMachineTerminal(machineId: string, input: NewTerminalCommand, typist: StartCommandTypist, open: OpenTerminalPage): Promise<void> {
  return RUN_IN_NEW_TERMINAL[typist](machineId, input, open);
}

function errorReason(error: unknown): string {
  return error instanceof Error && error.message !== "" ? error.message : "the terminal failed";
}

/** How long a new shell's stream may take to open: a phone on a slow link took longer than 10 s. */
const TYPE_COMMAND_OPEN_MS = 30_000;

/**
 * Type one command line into a new terminal and let go of the stream: what this page does for a
 * session daemon that does not type a start command itself. Not before the shell has drawn its
 * prompt (shared/terminalStartCommand), counted from the stream opening.
 */
function typeCommand(socket: WebSocket, command: string): Promise<TypeCommandOutcome> {
  return new Promise((resolve) => {
    let settled: ReturnType<typeof setTimeout> | undefined;
    let cap: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    const finish = (outcome: TypeCommandOutcome): void => {
      if (done) return;
      done = true;
      clearTimeout(opening);
      clearTimeout(settled);
      clearTimeout(cap);
      if (outcome === "typed") socket.send(JSON.stringify({ type: "input", data: `${command}\r` }));
      socket.close();
      resolve(outcome);
    };
    const type = (): void => { finish("typed"); };
    const opening = setTimeout(() => { finish("open-timeout"); }, TYPE_COMMAND_OPEN_MS);
    socket.addEventListener("open", () => {
      clearTimeout(opening);
      cap = setTimeout(type, SHELL_READY_CAP_MS);
    }, { once: true });
    socket.addEventListener("message", () => {
      clearTimeout(settled);
      settled = setTimeout(type, SHELL_SETTLED_MS);
    });
    socket.addEventListener("error", () => { finish("stream-failed"); }, { once: true });
    socket.addEventListener("close", () => { finish("closed"); }, { once: true });
  });
}
