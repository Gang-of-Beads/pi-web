import { spawn } from "node:child_process";
import { dirname, isAbsolute } from "node:path";

export interface SafeTunnelFrpcProcessRequest {
  readonly configPath: string;
  readonly frpcPath: string;
}

/** Terminal notification emitted only after the exact child reports close. */
export type SafeTunnelFrpcProcessExit =
  | {
    readonly exitCode: number | null;
    readonly kind: "exited";
    readonly signal: NodeJS.Signals | null;
  }
  | {
    readonly kind: "error";
  };

export interface SafeTunnelFrpcProcessObserver {
  readonly onExit: (exit: SafeTunnelFrpcProcessExit) => void;
  readonly onStderr?: (chunk: string) => void;
  readonly onStdout?: (chunk: string) => void;
}

/** The exact child returned by a launch. Callers never signal a persisted PID. */
export interface SafeTunnelFrpcProcessHandle {
  readonly pid?: number;
  dispose(): void;
  terminate(signal: NodeJS.Signals): boolean;
}

export interface SafeTunnelFrpcProcessLauncher {
  launch(
    request: SafeTunnelFrpcProcessRequest,
    observer: SafeTunnelFrpcProcessObserver,
  ): SafeTunnelFrpcProcessHandle;
}

interface SafeTunnelNodeReadable {
  setEncoding(encoding: BufferEncoding): this;
  on(event: "data", listener: (chunk: string) => void): this;
  off(event: "data", listener: (chunk: string) => void): this;
}

export interface SafeTunnelNodeChildProcess {
  readonly stderr: SafeTunnelNodeReadable;
  readonly stdout: SafeTunnelNodeReadable;
  kill(signal: NodeJS.Signals): boolean;
  offClose(
    listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void,
  ): void;
  offError(listener: (error: Error) => void): void;
  onceClose(
    listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void,
  ): void;
  onError(listener: (error: Error) => void): void;
  processId(): number | undefined;
}

export type SafeTunnelNodeProcessSpawner = (
  command: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly detached: false;
    readonly shell: false;
    readonly stdio: ["ignore", "pipe", "pipe"];
    readonly windowsHide: true;
  },
) => SafeTunnelNodeChildProcess;

export interface NodeSafeTunnelFrpcProcessLauncherOptions {
  readonly spawnProcess?: SafeTunnelNodeProcessSpawner;
}

/** Concrete Node adapter that owns only listeners attached to its returned child. */
export class NodeSafeTunnelFrpcProcessLauncher implements SafeTunnelFrpcProcessLauncher {
  private readonly spawnProcess: SafeTunnelNodeProcessSpawner;

  constructor(options: NodeSafeTunnelFrpcProcessLauncherOptions = {}) {
    this.spawnProcess = options.spawnProcess ?? spawnNodeFrpcProcess;
  }

  launch(
    request: SafeTunnelFrpcProcessRequest,
    observer: SafeTunnelFrpcProcessObserver,
  ): SafeTunnelFrpcProcessHandle {
    const configPath = requireAbsolutePath(request.configPath, "configPath");
    const frpcPath = requireAbsolutePath(request.frpcPath, "frpcPath");
    const child = this.spawnProcess(frpcPath, ["-c", configPath], {
      cwd: dirname(configPath),
      detached: false,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const pid = child.processId();
    let disposed = false;
    let settled = false;
    let spawnFailed = false;

    const onStdout = (chunk: string): void => { observer.onStdout?.(chunk); };
    const onStderr = (chunk: string): void => { observer.onStderr?.(chunk); };
    const cleanup = (): void => {
      if (disposed) return;
      disposed = true;
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.offError(onError);
      child.offClose(onClose);
    };
    const settle = (exit: SafeTunnelFrpcProcessExit): void => {
      if (settled) return;
      settled = true;
      cleanup();
      observer.onExit(exit);
    };
    const onError = (): void => {
      // ChildProcess also emits "error" when signal delivery fails. Only a
      // missing initial PID identifies a pre-spawn failure; close remains the
      // authoritative event that releases ownership in either case.
      if (pid === undefined) spawnFailed = true;
    };
    const onClose = (
      exitCode: number | null,
      signal: NodeJS.Signals | null,
    ): void => {
      settle(spawnFailed
        ? { kind: "error" }
        : { exitCode, kind: "exited", signal });
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.onError(onError);
    child.onceClose(onClose);

    return {
      ...(pid === undefined ? {} : { pid }),
      dispose: cleanup,
      terminate: (signal) => child.kill(signal),
    };
  }
}

function spawnNodeFrpcProcess(
  command: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly detached: false;
    readonly shell: false;
    readonly stdio: ["ignore", "pipe", "pipe"];
    readonly windowsHide: true;
  },
): SafeTunnelNodeChildProcess {
  const child = spawn(command, [...args], options);
  return {
    stderr: child.stderr,
    stdout: child.stdout,
    kill: (signal) => child.kill(signal),
    offClose: (listener) => { child.off("close", listener); },
    offError: (listener) => { child.off("error", listener); },
    onceClose: (listener) => { child.once("close", listener); },
    onError: (listener) => { child.on("error", listener); },
    processId: () => child.pid,
  };
}

function requireAbsolutePath(value: string, fieldName: string): string {
  if (value.trim() === "") throw new Error(`${fieldName} must be a non-empty path.`);
  if (!isAbsolute(value)) throw new Error(`${fieldName} must be an absolute path.`);
  return value;
}
