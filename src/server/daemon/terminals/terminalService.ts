import { isRecord } from "../../../shared/unknownValues.js";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type * as NodePty from "node-pty";
import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, join } from "node:path";
import { ensureSpawnHelperExecutable, spawnHelperFailureReason } from "./nodePtySpawnHelper.js";
import { terminalEnvironment } from "../piVersionChecks.js";
import type { TerminalCommandRun, TerminalCommandRunFilter, TerminalCommandRunStatus, TerminalUiEvent } from "../../../shared/apiTypes.js";
import type { SessionEventHub } from "../realtime/sessionEventHub.js";
import type { WorkspaceActivityService } from "../activity/workspaceActivityService.js";
import { SHELL_READY_CAP_MS, SHELL_SETTLED_MS } from "../../../shared/terminalStartCommand.js";

const MAX_REPLAY_BUFFER = 200_000;
/** The longest name a shell's tab takes (R12); the tab clamps what it shows, this keeps the record sane. */
const TERMINAL_NAME_MAX_LENGTH = 80;

export interface TerminalInfo {
  id: string;
  cwd: string;
  name: string;
  createdAt: string;
  exited: boolean;
  exitCode?: number;
  commandRunId?: string;
}

export interface RunTerminalCommandOptions {
  origin: string;
  projectId: string;
  workspaceId: string;
  cwd: string;
  title: string;
  command: string;
  metadata?: unknown;
  cols?: number;
  rows?: number;
}

interface TerminalRecord extends TerminalInfo {
  pty: NodePty.IPty;
  buffer: string;
  events: EventEmitter;
  commandRunId?: string;
  /** A start command still waiting for its shell to settle; `continue` restarts its wait on the new pty. */
  pendingStartCommand?: { rearm(): void };
}

export class TerminalService {
  private readonly terminals = new Map<string, TerminalRecord>();
  private readonly commandRuns = new Map<string, TerminalCommandRun>();

  constructor(private readonly events?: SessionEventHub, private readonly workspaceActivity?: Pick<WorkspaceActivityService, "updateTerminal" | "removeTerminal">) {}

  list(cwd: string): TerminalInfo[] {
    return [...this.terminals.values()]
      .filter((terminal) => terminal.cwd === cwd)
      .map(toInfo);
  }

  closeForCwd(cwd: string): void {
    if (cwd === "") throw new Error("cwd is required");
    for (const terminal of [...this.terminals.values()].filter((candidate) => candidate.cwd === cwd)) this.close(terminal.id);
  }

  create(options: { cwd: string; name?: string; cols?: number; rows?: number; startCommand?: string }): TerminalInfo {
    const { startCommand, ...terminal } = options;
    const shell = currentTerminalShell();
    const info = this.createTerminal({ ...terminal, shell, shellArgs: interactiveShellArgs(shell) });
    if (startCommand !== undefined) this.typeWhenSettled(info.id, startCommand);
    return info;
  }

  runCommand(options: RunTerminalCommandOptions): TerminalCommandRun {
    validateCommandRunOptions(options);
    const commandRunId = randomUUID();
    const terminalId = randomUUID();
    const createdAt = new Date().toISOString();
    const metadata = parseMetadata(options.metadata);
    const queued: TerminalCommandRun = {
      id: commandRunId,
      origin: options.origin,
      projectId: options.projectId,
      workspaceId: options.workspaceId,
      terminalId,
      title: options.title,
      command: options.command,
      status: "queued",
      createdAt,
      metadata,
    };
    const running: TerminalCommandRun = { ...queued, status: "running", startedAt: new Date().toISOString() };
    this.commandRuns.set(commandRunId, running);

    const shell = currentTerminalShell();
    try {
      this.createTerminal({
        id: terminalId,
        cwd: options.cwd,
        name: options.title,
        ...(options.cols === undefined ? {} : { cols: options.cols }),
        ...(options.rows === undefined ? {} : { rows: options.rows }),
        shell,
        shellArgs: commandRunShellArgs[terminalShellFamily(shell)](options.command),
        commandRunId,
      });
    } catch (error) {
      this.commandRuns.delete(commandRunId);
      throw error;
    }

    return copyCommandRun(this.commandRuns.get(commandRunId) ?? running);
  }

  listCommandRuns(filter: TerminalCommandRunFilter = {}): TerminalCommandRun[] {
    return [...this.commandRuns.values()]
      .filter((run) => matchesCommandRunFilter(run, filter))
      .map(copyCommandRun);
  }

  getCommandRun(runId: string): TerminalCommandRun | undefined {
    const run = this.commandRuns.get(runId);
    return run === undefined ? undefined : copyCommandRun(run);
  }

  cancelCommandRun(runId: string): TerminalCommandRun {
    const run = this.commandRuns.get(runId);
    if (run === undefined) throw new Error("Terminal command run not found");
    if (isTerminalCommandRunFinal(run.status)) return copyCommandRun(run);
    const terminal = this.terminals.get(run.terminalId);
    if (terminal === undefined) throw new Error("Terminal not found");
    if (!terminal.exited) terminal.pty.write("\x03");
    return copyCommandRun(run);
  }

  get(id: string): TerminalInfo | undefined {
    const terminal = this.terminals.get(id);
    return terminal === undefined ? undefined : toInfo(terminal);
  }

  attach(id: string, handlers: { output: (data: string, replay: boolean) => void; exit: (exitCode: number | undefined) => void }): () => void {
    const terminal = this.require(id);
    if (terminal.buffer !== "") handlers.output(terminal.buffer, true);
    if (terminal.exited) handlers.exit(terminal.exitCode);
    const onOutput = (data: string) => { handlers.output(data, false); };
    const onExit = (exitCode: number | undefined) => { handlers.exit(exitCode); };
    terminal.events.on("output", onOutput);
    terminal.events.on("exit", onExit);
    return () => {
      terminal.events.off("output", onOutput);
      terminal.events.off("exit", onExit);
    };
  }

  write(id: string, data: string): void {
    const terminal = this.require(id);
    if (!terminal.exited) terminal.pty.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const terminal = this.require(id);
    if (!terminal.exited && Number.isFinite(cols) && Number.isFinite(rows) && cols > 0 && rows > 0) {
      terminal.pty.resize(Math.floor(cols), Math.floor(rows));
    }
  }

  continue(id: string): TerminalInfo {
    const record = this.require(id);
    if (!record.exited) return toInfo(record);
    const nodePty = loadNodePty();
    delete record.exitCode;
    delete record.commandRunId;
    record.exited = false;
    const marker = "\r\n[continued in interactive shell]\r\n";
    record.buffer = trimReplayBuffer(record.buffer + marker);
    record.events.emit("output", marker);
    const shell = currentTerminalShell();
    record.pty = nodePty.spawn(shell, interactiveShellArgs(shell), {
      name: "xterm-256color",
      cwd: record.cwd,
      cols: 100,
      rows: 30,
      env: { ...terminalEnvironment(), TERM: "xterm-256color", PI_WEB_TERMINAL: "1" },
    });
    this.attachPtyEvents(record);
    record.pendingStartCommand?.rearm();
    const info = toInfo(record);
    this.workspaceActivity?.updateTerminal(info);
    this.publish({ type: "terminal.created", terminal: info });
    return info;
  }

  /** Rename a shell (R12): the name lives with the shell, so every page that lists it reads the new one. */
  rename(id: string, name: string): TerminalInfo {
    const record = this.require(id);
    record.name = terminalName(name);
    return toInfo(record);
  }

  close(id: string): void {
    const terminal = this.terminals.get(id);
    if (terminal === undefined) return;
    this.terminals.delete(id);
    terminal.events.removeAllListeners();
    this.workspaceActivity?.removeTerminal(id, terminal.cwd);
    if (!terminal.exited) terminal.pty.kill();
    this.publish({ type: "terminal.closed", terminalId: id, cwd: terminal.cwd });
  }

  dispose(): void {
    for (const id of [...this.terminals.keys()]) this.close(id);
  }

  private createTerminal(options: { id?: string; cwd: string; name?: string; cols?: number; rows?: number; shell: string; shellArgs: string[]; commandRunId?: string }): TerminalInfo {
    if (options.cwd === "") throw new Error("cwd is required");
    // Validate before spawning: a pty in a missing directory starts a shell that
    // chdir-fails and exits code 1 instantly - a dead tab with no explanation.
    try {
      if (!statSync(options.cwd).isDirectory()) throw new Error("not a directory");
    } catch {
      throw new Error(`Workspace folder does not exist: ${options.cwd}`);
    }
    const id = options.id ?? randomUUID();
    const createdAt = new Date().toISOString();
    const nodePty = loadNodePty();
    // node-pty's published helper may lack its execute bit; repair it once
    // before the first spawn (see nodePtySpawnHelper).
    ensureSpawnHelperExecutable();
    const terminal = spawnWithHelperDiagnostic(() => nodePty.spawn(options.shell, options.shellArgs, {
      name: "xterm-256color",
      cwd: options.cwd,
      cols: options.cols ?? 100,
      rows: options.rows ?? 30,
      env: { ...terminalEnvironment(), TERM: "xterm-256color", PI_WEB_TERMINAL: "1" },
    }));
    const requestedName = options.name?.trim();
    const record: TerminalRecord = {
      id,
      cwd: options.cwd,
      name: requestedName !== undefined && requestedName !== "" ? requestedName : `Shell ${String(this.list(options.cwd).length + 1)}`,
      createdAt,
      exited: false,
      pty: terminal,
      buffer: "",
      events: new EventEmitter(),
      ...(options.commandRunId === undefined ? {} : { commandRunId: options.commandRunId }),
    };
    this.attachPtyEvents(record);
    this.terminals.set(id, record);
    const info = toInfo(record);
    this.workspaceActivity?.updateTerminal(info);
    this.publish({ type: "terminal.created", terminal: info });
    return info;
  }

  /**
   * Type a new shell's start command once its output has gone quiet (shared/terminalStartCommand).
   * The daemon types it, not the page: a page's second stream to the shell may open too late, and
   * the command was lost with it (owner report, 2026-10-21). A shell closed or exited by then gets
   * nothing. A shell continued while the command waits starts the wait again from its new pty: the
   * "continued" marker is not the new shell's prompt (review d3c7f62a, P2-3).
   */
  private typeWhenSettled(id: string, command: string): void {
    const record = this.require(id);
    let settled: NodeJS.Timeout | undefined;
    let cap: NodeJS.Timeout | undefined;
    const type = (): void => {
      clearTimeout(settled);
      clearTimeout(cap);
      record.events.off("output", onOutput);
      delete record.pendingStartCommand;
      if (this.terminals.get(id) === record && !record.exited) record.pty.write(`${command}\r`);
    };
    const onOutput = (): void => {
      clearTimeout(settled);
      settled = setTimeout(type, SHELL_SETTLED_MS).unref();
    };
    const armCap = (): void => {
      clearTimeout(settled);
      clearTimeout(cap);
      cap = setTimeout(type, SHELL_READY_CAP_MS).unref();
    };
    record.pendingStartCommand = { rearm: armCap };
    armCap();
    record.events.on("output", onOutput);
  }

  private attachPtyEvents(record: TerminalRecord): void {
    record.pty.onData((data) => {
      record.buffer = trimReplayBuffer(record.buffer + data);
      record.events.emit("output", data);
    });
    record.pty.onExit(({ exitCode }) => {
      record.exited = true;
      record.exitCode = exitCode;
      this.completeCommandRun(record.commandRunId, exitCode);
      record.events.emit("exit", exitCode);
      const info = toInfo(record);
      this.workspaceActivity?.updateTerminal(info);
      this.publish({ type: "terminal.exited", terminal: info });
    });
  }

  private completeCommandRun(runId: string | undefined, exitCode: number | undefined): void {
    if (runId === undefined) return;
    const run = this.commandRuns.get(runId);
    if (run === undefined || isTerminalCommandRunFinal(run.status)) return;
    const completed: TerminalCommandRun = {
      ...run,
      status: exitCode === 0 ? "succeeded" : "failed",
      ...(exitCode === undefined ? {} : { exitCode }),
      completedAt: new Date().toISOString(),
    };
    this.commandRuns.set(runId, completed);
  }

  private require(id: string): TerminalRecord {
    const terminal = this.terminals.get(id);
    if (terminal === undefined) throw new Error("Terminal not found");
    return terminal;
  }

  private publish(event: TerminalUiEvent): void {
    this.events?.publishRealtime(event);
  }
}

const requireFromHere = createRequire(import.meta.url);
let loadedNodePty: typeof NodePty | undefined;

function isNodePtyModule(value: unknown): value is typeof NodePty {
  return isRecord(value) && typeof value["spawn"] === "function";
}

/**
 * node-pty, loaded on the first terminal rather than when the daemon starts. It is a native
 * module npm may have failed to build or skipped (it is an optional dependency, and Linux has no
 * prebuilt binary), and agents do not need it: loading it at startup let a missing `pty.node`
 * stop every session. A failed load is not cached, so a repaired install is picked up by the next
 * terminal.
 */
function loadNodePty(): typeof NodePty {
  if (loadedNodePty !== undefined) return loadedNodePty;
  let loaded: unknown;
  try {
    loaded = requireFromHere("node-pty");
  } catch (error) {
    throw new Error(`Terminals are unavailable on this machine: node-pty could not load (${(error instanceof Error ? error.message : String(error)).split("\n")[0] ?? ""}). Sessions keep working. Run \`pi-web doctor\`.`, { cause: error });
  }
  if (!isNodePtyModule(loaded)) throw new Error("Terminals are unavailable on this machine: node-pty loaded without a spawn function. Sessions keep working. Run `pi-web doctor`.");
  loadedNodePty = loaded;
  return loaded;
}

function toInfo(record: TerminalRecord): TerminalInfo {
  return {
    id: record.id,
    cwd: record.cwd,
    name: record.name,
    createdAt: record.createdAt,
    exited: record.exited,
    ...(record.exitCode === undefined ? {} : { exitCode: record.exitCode }),
    ...(record.commandRunId === undefined ? {} : { commandRunId: record.commandRunId }),
  };
}

function terminalName(value: string): string {
  const name = value.trim();
  if (name === "") throw new Error("A shell name cannot be empty");
  if (name.length > TERMINAL_NAME_MAX_LENGTH) throw new Error(`A shell name is at most ${String(TERMINAL_NAME_MAX_LENGTH)} characters`);
  return name;
}

function trimReplayBuffer(buffer: string): string {
  if (buffer.length <= MAX_REPLAY_BUFFER) return buffer;
  return buffer.slice(buffer.length - MAX_REPLAY_BUFFER);
}

/**
 * The shell a terminal runs: an explicit `SHELL` wins; otherwise bash on
 * POSIX, and on Windows, which has neither `SHELL` nor bash, PowerShell 7
 * (`pwsh.exe`) when it is installed and Windows PowerShell otherwise.
 */
export function terminalShell(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, isOnPath: (executable: string) => boolean): string {
  const configured = env["SHELL"];
  if (configured !== undefined) return configured;
  if (platform !== "win32") return "/bin/bash";
  return isOnPath("pwsh.exe") ? "pwsh.exe" : "powershell.exe";
}

function currentTerminalShell(): string {
  return terminalShell(process.env, process.platform, (executable) => executableOnPath(executable, process.env["PATH"] ?? ""));
}

function executableOnPath(executable: string, path: string): boolean {
  return path.split(delimiter).some((directory) => directory !== "" && existsSync(join(directory, executable)));
}

type TerminalShellFamily = "posix" | "powershell";

function shellExecutableName(shell: string): string | undefined {
  return shell.split(/[\\/]/).at(-1)?.toLowerCase().replace(/^-/, "").replace(/\.exe$/, "");
}

export function terminalShellFamily(shell: string): TerminalShellFamily {
  const executable = shellExecutableName(shell);
  return executable === "pwsh" || executable === "powershell" ? "powershell" : "posix";
}

export function interactiveShellArgs(shell: string): string[] {
  const executable = shellExecutableName(shell);
  // Preserve the existing invocation for arbitrary SHELL values rather than guessing at an unsupported login flag.
  return executable === "bash" || executable === "zsh" || executable === "fish" ? ["-l"] : [];
}

/**
 * A command run echoes `$ <command>` and then runs the command, exiting with
 * its status. PowerShell receives the script as `-EncodedCommand` (UTF-16LE
 * base64) because Windows command-line quoting and PowerShell's own argument
 * parsing both mangle embedded quotes, and it reports a failed native command
 * through `$LASTEXITCODE` rather than its own exit status.
 */
export const commandRunShellArgs: Record<TerminalShellFamily, (command: string) => string[]> = {
  posix: (command) => ["-lc", commandRunShellScript(command)],
  powershell: (command) => ["-NoLogo", "-EncodedCommand", Buffer.from(powershellCommandRunScript(command), "utf16le").toString("base64")],
};

function powershellCommandRunScript(command: string): string {
  return `Write-Host ${powershellSingleQuote(`$ ${command}`)}\n${command}\nif (-not $?) { if ($LASTEXITCODE) { exit $LASTEXITCODE } else { exit 1 } }`;
}

function commandRunShellScript(command: string): string {
  return `printf '%s\\n' ${shellQuote(`$ ${command}`)}\n${command}`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function powershellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function validateCommandRunOptions(options: RunTerminalCommandOptions): void {
  if (options.origin.trim() === "") throw new Error("origin is required");
  if (options.projectId.trim() === "") throw new Error("projectId is required");
  if (options.workspaceId.trim() === "") throw new Error("workspaceId is required");
  if (options.cwd.trim() === "") throw new Error("cwd is required");
  if (options.title.trim() === "") throw new Error("title is required");
  if (options.command.trim() === "") throw new Error("command is required");
  parseMetadata(options.metadata);
}

function parseMetadata(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error("metadata must be an object");
  return Object.fromEntries(Object.entries(value).map(([key, metadataValue]) => {
    if (key.trim() === "") throw new Error("metadata keys must not be empty");
    if (typeof metadataValue !== "string") throw new Error("metadata values must be strings");
    return [key, metadataValue];
  }));
}

function matchesCommandRunFilter(run: TerminalCommandRun, filter: TerminalCommandRunFilter): boolean {
  if (filter.projectId !== undefined && run.projectId !== filter.projectId) return false;
  if (filter.workspaceId !== undefined && run.workspaceId !== filter.workspaceId) return false;
  if (filter.terminalId !== undefined && run.terminalId !== filter.terminalId) return false;
  if (filter.statuses !== undefined && filter.statuses.length > 0 && !filter.statuses.includes(run.status)) return false;
  for (const [key, value] of Object.entries(filter.metadata ?? {})) {
    if (run.metadata[key] !== value) return false;
  }
  return true;
}

function isTerminalCommandRunFinal(status: TerminalCommandRunStatus): boolean {
  return status === "succeeded" || status === "failed";
}

function copyCommandRun(run: TerminalCommandRun): TerminalCommandRun {
  return { ...run, metadata: { ...run.metadata } };
}

/**
 * Spawn a PTY, replacing node-pty's bare failure with the reason when this
 * process already knows it.
 *
 * node-pty reports an unusable helper as "posix_spawnp failed." - which names
 * neither the file nor the cause, and is what a reader sees in place of a
 * terminal. When the repair pass found a helper it could not fix, that is
 * almost certainly this failure, and saying so turns a dead end into an
 * instruction.
 */
function spawnWithHelperDiagnostic<T>(spawn: () => T): T {
  try {
    return spawn();
  } catch (error) {
    const reason = spawnHelperFailureReason();
    if (reason === undefined) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${detail}\n\n${reason}`, { cause: error });
  }
}
