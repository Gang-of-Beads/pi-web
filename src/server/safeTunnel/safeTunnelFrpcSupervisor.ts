import type {
  SafeTunnelCommandOutput,
  SafeTunnelRuntimeStatus,
} from "../../shared/apiTypes.js";
import {
  SafeTunnelFrpcAcquisitionError,
  type SafeTunnelManagedFrpc,
  type SafeTunnelManagedFrpcProvider,
} from "./safeTunnelFrpcManager.js";
import type {
  SafeTunnelFrpcProcessExit,
  SafeTunnelFrpcProcessHandle,
  SafeTunnelFrpcProcessLauncher,
} from "./safeTunnelFrpcProcess.js";
import {
  safeTunnelFrpcLogTailCharacters,
  type SafeTunnelFrpcRuntimeFiles,
} from "./safeTunnelFrpcRuntimeFiles.js";
import type { SafeTunnelPreparedTunnelConfig } from "./safeTunnelService.js";

const defaultInitialRestartDelayMs = 1_000;
const defaultMaximumRestartDelayMs = 30_000;
const defaultStableRunDurationMs = 60_000;
const defaultStopGracePeriodMs = 5_000;
const defaultKillGracePeriodMs = 2_000;

export type SafeTunnelFrpcSupervisorErrorCode =
  | "already_running"
  | "config_write_failed"
  | "frpc_acquisition_failed"
  | "process_launch_failed"
  | "process_stop_failed"
  | "start_cancelled"
  | "supervisor_shutdown"
  | "tunnel_config_failed";

export class SafeTunnelFrpcSupervisorError extends Error {
  constructor(
    readonly code: SafeTunnelFrpcSupervisorErrorCode,
    readonly detailCode?: string,
  ) {
    super(safeTunnelFrpcSupervisorErrorMessage(code, detailCode));
    this.name = "SafeTunnelFrpcSupervisorError";
  }
}

export interface SafeTunnelScheduledTask {
  cancel(): void;
}

export interface SafeTunnelSupervisorClock {
  now(): Date;
  schedule(callback: () => void, delayMs: number): SafeTunnelScheduledTask;
}

export class NodeSafeTunnelSupervisorClock implements SafeTunnelSupervisorClock {
  now(): Date {
    return new Date();
  }

  schedule(callback: () => void, delayMs: number): SafeTunnelScheduledTask {
    let active = true;
    const timeout = setTimeout(() => {
      if (!active) return;
      active = false;
      callback();
    }, delayMs);
    return {
      cancel(): void {
        if (!active) return;
        active = false;
        clearTimeout(timeout);
      },
    };
  }
}

export interface SafeTunnelFrpcSupervisorPolicy {
  readonly initialRestartDelayMs?: number;
  readonly killGracePeriodMs?: number;
  readonly maximumRestartDelayMs?: number;
  readonly stableRunDurationMs?: number;
  readonly stopGracePeriodMs?: number;
}

export interface SafeTunnelFrpcConfigProvider {
  getTunnelConfig(options?: {
    readonly signal?: AbortSignal;
  }): Promise<SafeTunnelPreparedTunnelConfig>;
}

export interface SafeTunnelFrpcStartInput {
  readonly advancedFrpcPath?: string;
}

export interface SafeTunnelFrpcStartResult {
  readonly output: string;
  readonly pid?: number;
  readonly publicUrl: string;
}

export interface SafeTunnelFrpcRuntime {
  shutdown(): Promise<void>;
  start(input: SafeTunnelFrpcStartInput): Promise<SafeTunnelFrpcStartResult>;
  status(): Promise<SafeTunnelRuntimeStatus>;
  stop(): Promise<SafeTunnelCommandOutput>;
}

export interface SafeTunnelFrpcSupervisorDependencies {
  readonly clock?: SafeTunnelSupervisorClock;
  readonly configProvider: SafeTunnelFrpcConfigProvider;
  readonly files: SafeTunnelFrpcRuntimeFiles;
  readonly launcher: SafeTunnelFrpcProcessLauncher;
  readonly managedFrpc: SafeTunnelManagedFrpcProvider;
  readonly policy?: SafeTunnelFrpcSupervisorPolicy;
}

type SupervisorPhase =
  | "retrying"
  | "running"
  | "shutdown"
  | "starting"
  | "stopped"
  | "stopping";

interface NormalizedSupervisorPolicy {
  readonly initialRestartDelayMs: number;
  readonly killGracePeriodMs: number;
  readonly maximumRestartDelayMs: number;
  readonly stableRunDurationMs: number;
  readonly stopGracePeriodMs: number;
}

interface OwnedFrpcProcess {
  readonly completion: Promise<void>;
  readonly generation: number;
  readonly handle: SafeTunnelFrpcProcessHandle;
  resolveCompletion: () => void;
  exit?: SafeTunnelFrpcProcessExit;
  closed: boolean;
  stopRequested: boolean;
}

/**
 * Owns the one exact frpc child launched by this PI WEB process. Persisted PIDs
 * are deliberately absent: disable and shutdown can signal only this handle.
 */
export class SafeTunnelFrpcSupervisor implements SafeTunnelFrpcRuntime {
  private activeAttempt: Promise<SafeTunnelFrpcStartResult> | undefined;
  private activeAttemptAbortController: AbortController | undefined;
  private activeProcess: OwnedFrpcProcess | undefined;
  private readonly clock: SafeTunnelSupervisorClock;
  private consecutiveFailures = 0;
  private disposed = false;
  private generation = 0;
  private lastError: string | undefined;
  private phase: SupervisorPhase = "stopped";
  private readonly policy: NormalizedSupervisorPolicy;
  private restartTask: SafeTunnelScheduledTask | undefined;
  private runRequested = false;
  private stableRunTask: SafeTunnelScheduledTask | undefined;
  private stopInFlight: Promise<SafeTunnelCommandOutput> | undefined;

  constructor(private readonly dependencies: SafeTunnelFrpcSupervisorDependencies) {
    this.clock = dependencies.clock ?? new NodeSafeTunnelSupervisorClock();
    this.policy = normalizePolicy(dependencies.policy);
  }

  start(input: SafeTunnelFrpcStartInput): Promise<SafeTunnelFrpcStartResult> {
    if (this.disposed) {
      return Promise.reject(new SafeTunnelFrpcSupervisorError("supervisor_shutdown"));
    }
    if (
      this.stopInFlight !== undefined
      || this.activeAttempt !== undefined
      || this.activeProcess !== undefined
    ) {
      return Promise.reject(new SafeTunnelFrpcSupervisorError("already_running"));
    }

    this.cancelRestartTask();
    this.cancelStableRunTask();
    this.generation += 1;
    const generation = this.generation;
    this.runRequested = true;
    this.consecutiveFailures = 0;
    this.lastError = undefined;
    this.phase = "starting";
    const controller = new AbortController();
    const attempt = this.performInitialAttempt(generation, input, controller.signal);
    return this.trackAttempt(attempt, controller);
  }

  async stop(): Promise<SafeTunnelCommandOutput> {
    return this.stopRuntime();
  }

  async shutdown(): Promise<void> {
    if (!this.disposed) {
      this.disposed = true;
      await this.stopRuntime();
      return;
    }
    if (this.stopInFlight !== undefined) {
      await this.stopInFlight;
      return;
    }
    if (this.activeProcess !== undefined) await this.stopRuntime();
  }

  async status(): Promise<SafeTunnelRuntimeStatus> {
    const files = await this.dependencies.files.status();
    const runtimeError = this.lastError ?? files.configError;
    return {
      state: runtimeStateFor(this.phase, this.activeProcess !== undefined),
      frpcConfigExists: files.configExists,
      frpcConfigPath: this.dependencies.files.configPath,
      ...(this.activeProcess?.handle.pid === undefined
        ? {}
        : { pid: this.activeProcess.handle.pid }),
      ...(runtimeError === undefined ? {} : { error: runtimeError }),
      ...(files.logError === undefined ? {} : { logError: files.logError }),
      logExists: files.logExists,
      logPath: this.dependencies.files.logPath,
      ...(files.logTail === undefined ? {} : { logTail: files.logTail }),
      logTailMaxCharacters: safeTunnelFrpcLogTailCharacters,
    };
  }

  private runAttempt(
    generation: number,
    input: SafeTunnelFrpcStartInput,
  ): Promise<SafeTunnelFrpcStartResult> {
    if (this.activeAttempt !== undefined) {
      return Promise.reject(new SafeTunnelFrpcSupervisorError("already_running"));
    }

    this.phase = "starting";
    const controller = new AbortController();
    return this.trackAttempt(
      this.performAttempt(generation, input, controller.signal),
      controller,
    );
  }

  private async performInitialAttempt(
    generation: number,
    input: SafeTunnelFrpcStartInput,
    signal: AbortSignal,
  ): Promise<SafeTunnelFrpcStartResult> {
    await this.resetLogSafely(createStartLogHeader(this.clock.now(), "requested"));
    this.assertCurrentAttempt(generation);
    return this.performAttempt(generation, input, signal);
  }

  private trackAttempt(
    attempt: Promise<SafeTunnelFrpcStartResult>,
    controller: AbortController,
  ): Promise<SafeTunnelFrpcStartResult> {
    this.activeAttempt = attempt;
    this.activeAttemptAbortController = controller;
    const clear = (): void => {
      if (this.activeAttempt !== attempt) return;
      this.activeAttempt = undefined;
      if (this.activeAttemptAbortController === controller) {
        this.activeAttemptAbortController = undefined;
      }
    };
    void attempt.then(clear, clear);
    return attempt;
  }

  private async performAttempt(
    generation: number,
    input: SafeTunnelFrpcStartInput,
    signal: AbortSignal,
  ): Promise<SafeTunnelFrpcStartResult> {
    let tunnelConfig: SafeTunnelPreparedTunnelConfig;
    try {
      tunnelConfig = await abortable(
        this.dependencies.configProvider.getTunnelConfig({ signal }),
        signal,
      );
    } catch {
      if (signal.aborted) throw new SafeTunnelFrpcSupervisorError("start_cancelled");
      throw this.failAttempt(
        generation,
        input,
        new SafeTunnelFrpcSupervisorError("tunnel_config_failed"),
      );
    }
    this.assertCurrentAttempt(generation);

    let managedFrpc: SafeTunnelManagedFrpc | undefined;
    let frpcPath = input.advancedFrpcPath;
    if (frpcPath === undefined) {
      try {
        managedFrpc = await abortable(
          this.dependencies.managedFrpc.ensureManagedFrpc(),
          signal,
        );
        frpcPath = managedFrpc.path;
      } catch (error: unknown) {
        if (signal.aborted) throw new SafeTunnelFrpcSupervisorError("start_cancelled");
        const detailCode = error instanceof SafeTunnelFrpcAcquisitionError
          ? error.code
          : undefined;
        throw this.failAttempt(
          generation,
          input,
          new SafeTunnelFrpcSupervisorError("frpc_acquisition_failed", detailCode),
        );
      }
    }
    this.assertCurrentAttempt(generation);

    try {
      await this.dependencies.files.writeConfig(tunnelConfig.frpcConfigToml);
    } catch {
      throw this.failAttempt(
        generation,
        input,
        new SafeTunnelFrpcSupervisorError("config_write_failed"),
      );
    }
    this.assertCurrentAttempt(generation);

    if (this.consecutiveFailures > 0) {
      this.dependencies.files.appendLog(
        createStartLogHeader(this.clock.now(), `restart ${this.consecutiveFailures.toString()}`),
      );
    }
    const output = startOutput(tunnelConfig, managedFrpc);
    this.dependencies.files.appendLog(output);

    let earlyExit: SafeTunnelFrpcProcessExit | undefined;
    const ownership: { current?: OwnedFrpcProcess } = {};
    const outputRedactor = new SafeTunnelProcessOutputRedactor([
      this.dependencies.files.configPath,
      frpcPath,
      ...sensitiveTomlValues(tunnelConfig.frpcConfigToml),
    ]);
    let handle: SafeTunnelFrpcProcessHandle;
    try {
      handle = this.dependencies.launcher.launch({
        configPath: this.dependencies.files.configPath,
        frpcPath,
      }, {
        onExit: (exit) => {
          this.dependencies.files.appendLog(outputRedactor.flush());
          if (ownership.current === undefined) earlyExit = exit;
          else this.handleProcessExit(ownership.current, exit, input);
        },
        onStderr: (chunk) => {
          this.dependencies.files.appendLog(outputRedactor.write("stderr", chunk));
        },
        onStdout: (chunk) => {
          this.dependencies.files.appendLog(outputRedactor.write("stdout", chunk));
        },
      });
    } catch {
      throw this.failAttempt(
        generation,
        input,
        new SafeTunnelFrpcSupervisorError("process_launch_failed"),
      );
    }

    const owned = createOwnedProcess(handle, generation);
    ownership.current = owned;
    this.activeProcess = owned;
    this.phase = "running";
    this.lastError = undefined;

    if (earlyExit !== undefined) {
      this.handleProcessExit(owned, earlyExit, input);
      throw new SafeTunnelFrpcSupervisorError("process_launch_failed");
    }

    this.scheduleStableRunReset(owned);
    return {
      output,
      ...(handle.pid === undefined ? {} : { pid: handle.pid }),
      publicUrl: tunnelConfig.publicUrl,
    };
  }

  private failAttempt(
    generation: number,
    input: SafeTunnelFrpcStartInput,
    error: SafeTunnelFrpcSupervisorError,
  ): SafeTunnelFrpcSupervisorError {
    if (this.isCurrentAttempt(generation)) {
      this.scheduleRestart(error, generation, input);
    }
    return error;
  }

  private handleProcessExit(
    owned: OwnedFrpcProcess,
    exit: SafeTunnelFrpcProcessExit,
    input: SafeTunnelFrpcStartInput,
  ): void {
    if (this.activeProcess !== owned || owned.closed) return;
    owned.exit = exit;
    this.releaseClosedProcess(owned);

    if (owned.stopRequested || !this.isCurrentAttempt(owned.generation)) {
      this.phase = this.disposed ? "shutdown" : "stopped";
      this.lastError = undefined;
      return;
    }

    const error = unexpectedExitError(exit);
    this.scheduleRestart(error, owned.generation, input);
  }

  private scheduleRestart(
    error: Error,
    generation: number,
    input: SafeTunnelFrpcStartInput,
  ): void {
    if (!this.isCurrentAttempt(generation)) return;
    this.cancelRestartTask();
    this.cancelStableRunTask();
    this.consecutiveFailures += 1;
    const delayMs = restartDelay(this.consecutiveFailures, this.policy);
    this.phase = "retrying";
    this.lastError = `${error.message} Retrying in ${formatDelay(delayMs)}.`;
    this.dependencies.files.appendLog(`${this.lastError}\n`);
    this.restartTask = this.clock.schedule(() => {
      this.restartTask = undefined;
      if (!this.isCurrentAttempt(generation)) return;
      void this.runAttempt(generation, input).catch(() => undefined);
    }, delayMs);
  }

  private scheduleStableRunReset(owned: OwnedFrpcProcess): void {
    this.cancelStableRunTask();
    this.stableRunTask = this.clock.schedule(() => {
      this.stableRunTask = undefined;
      if (this.activeProcess !== owned || !this.isCurrentAttempt(owned.generation)) return;
      this.consecutiveFailures = 0;
    }, this.policy.stableRunDurationMs);
  }

  private stopRuntime(): Promise<SafeTunnelCommandOutput> {
    if (this.stopInFlight !== undefined) return this.stopInFlight;

    this.runRequested = false;
    this.generation += 1;
    this.activeAttemptAbortController?.abort();
    this.cancelRestartTask();
    this.cancelStableRunTask();
    const stopping = this.performStop();
    this.stopInFlight = stopping;
    void stopping.then(
      () => { if (this.stopInFlight === stopping) this.stopInFlight = undefined; },
      () => { if (this.stopInFlight === stopping) this.stopInFlight = undefined; },
    );
    return stopping;
  }

  private async performStop(): Promise<SafeTunnelCommandOutput> {
    const activeAttempt = this.activeAttempt;
    if (activeAttempt !== undefined) await activeAttempt.catch(() => undefined);

    const owned = this.activeProcess;
    let output: SafeTunnelCommandOutput = {
      exitCode: 0,
      stderr: "",
      stdout: "No running PI WEB Safe Tunnel frpc process was found.\n",
    };
    let stopError: SafeTunnelFrpcSupervisorError | undefined;

    if (owned !== undefined) {
      owned.stopRequested = true;
      this.phase = "stopping";
      const terminateRequested = this.trySignalOwnedProcess(owned, "SIGTERM");

      let stopped = owned.closed;
      if (!stopped && terminateRequested) {
        stopped = await this.waitForOwnedProcess(owned, this.policy.stopGracePeriodMs);
      }

      let forceKillRequested = false;
      if (!stopped) {
        forceKillRequested = this.trySignalOwnedProcess(owned, "SIGKILL");
        stopped = owned.closed;
        if (!stopped) {
          stopped = await this.waitForOwnedProcess(owned, this.policy.killGracePeriodMs);
        }
      }

      if (!stopped) {
        // A signal result or error cannot prove termination. Keep the exact
        // handle owned to prevent replacement until an eventual close releases it.
        stopError = new SafeTunnelFrpcSupervisorError("process_stop_failed");
      } else {
        const forceStopped = forceKillRequested
          && owned.exit?.kind === "exited"
          && owned.exit.signal === "SIGKILL";
        output = {
          exitCode: 0,
          stderr: "",
          stdout: forceStopped
            ? "PI WEB force-stopped its owned Safe Tunnel frpc process.\n"
            : "PI WEB stopped its owned Safe Tunnel frpc process.\n",
          ...(forceStopped ? { signal: "SIGKILL" } : {}),
        };
      }
    }

    try {
      await this.dependencies.files.removeConfig();
    } catch {
      stopError ??= new SafeTunnelFrpcSupervisorError("config_write_failed");
    }
    await this.dependencies.files.flushLog();
    if (this.activeProcess !== undefined) this.phase = "stopping";
    else this.phase = this.disposed ? "shutdown" : "stopped";
    this.lastError = stopError?.message;
    if (stopError !== undefined) throw stopError;
    return output;
  }

  private trySignalOwnedProcess(
    owned: OwnedFrpcProcess,
    signal: NodeJS.Signals,
  ): boolean {
    try {
      return owned.handle.terminate(signal);
    } catch {
      return false;
    }
  }

  private waitForOwnedProcess(
    owned: OwnedFrpcProcess,
    timeoutMs: number,
  ): Promise<boolean> {
    if (owned.closed) return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      const timeout = this.clock.schedule(() => {
        if (settled) return;
        settled = true;
        resolve(false);
      }, timeoutMs);
      void owned.completion.then(() => {
        if (settled) return;
        settled = true;
        timeout.cancel();
        resolve(true);
      });
    });
  }

  private releaseClosedProcess(owned: OwnedFrpcProcess): void {
    if (owned.closed) return;
    owned.closed = true;
    owned.handle.dispose();
    if (this.activeProcess === owned) this.activeProcess = undefined;
    this.cancelStableRunTask();
    owned.resolveCompletion();
  }

  private assertCurrentAttempt(generation: number): void {
    if (!this.isCurrentAttempt(generation)) {
      throw new SafeTunnelFrpcSupervisorError("start_cancelled");
    }
  }

  private isCurrentAttempt(generation: number): boolean {
    return this.runRequested && !this.disposed && this.generation === generation;
  }

  private cancelRestartTask(): void {
    this.restartTask?.cancel();
    this.restartTask = undefined;
  }

  private cancelStableRunTask(): void {
    this.stableRunTask?.cancel();
    this.stableRunTask = undefined;
  }

  private async resetLogSafely(header: string): Promise<void> {
    await this.dependencies.files.resetLog(header).catch(() => undefined);
  }
}

class SafeTunnelProcessOutputRedactor {
  private readonly carry = { stderr: "", stdout: "" };
  private readonly maximumSecretLength: number;
  private readonly secrets: readonly string[];

  constructor(values: readonly string[]) {
    this.secrets = [...new Set(values.filter((value) => value.length >= 4))]
      .sort((left, right) => right.length - left.length);
    this.maximumSecretLength = Math.max(1, ...this.secrets.map((value) => value.length));
  }

  write(stream: "stderr" | "stdout", chunk: string): string {
    const combined = `${this.carry[stream]}${chunk}`;
    let boundary = Math.max(0, combined.length - (this.maximumSecretLength - 1));
    for (const secret of this.secrets) {
      let searchFrom = 0;
      for (;;) {
        const index = combined.indexOf(secret, searchFrom);
        if (index < 0) break;
        if (index < boundary && index + secret.length > boundary) boundary = index;
        searchFrom = index + secret.length;
      }
    }
    const safe = combined.slice(0, boundary);
    this.carry[stream] = combined.slice(boundary);
    return this.redact(safe);
  }

  flush(): string {
    const output = this.redact(`${this.carry.stdout}${this.carry.stderr}`);
    this.carry.stdout = "";
    this.carry.stderr = "";
    return output;
  }

  private redact(value: string): string {
    let redacted = value;
    for (const secret of this.secrets) redacted = redacted.split(secret).join("[redacted]");
    return redacted;
  }
}

function sensitiveTomlValues(toml: string): string[] {
  const values: string[] = [];
  const sensitiveScalar = /^\s*(?:[A-Za-z0-9_-]+\.)*(?:password|secret|token)\s*=\s*("(?:[^"\\]|\\.)*")/gimu;
  for (const match of toml.matchAll(sensitiveScalar)) {
    const literal = match[1];
    if (literal === undefined) continue;
    try {
      const value: unknown = JSON.parse(literal);
      if (typeof value === "string") values.push(value);
    } catch {
      // Invalid TOML is rejected by frpc; do not expose its unparsed scalar here.
    }
  }
  return values;
}

function createOwnedProcess(
  handle: SafeTunnelFrpcProcessHandle,
  generation: number,
): OwnedFrpcProcess {
  let resolveCompletion = (): void => undefined;
  const completion = new Promise<void>((resolve) => { resolveCompletion = resolve; });
  return {
    completion,
    generation,
    handle,
    resolveCompletion,
    closed: false,
    stopRequested: false,
  };
}

function normalizePolicy(
  policy: SafeTunnelFrpcSupervisorPolicy = {},
): NormalizedSupervisorPolicy {
  const normalized = {
    initialRestartDelayMs: positiveInteger(
      policy.initialRestartDelayMs ?? defaultInitialRestartDelayMs,
      "initialRestartDelayMs",
    ),
    killGracePeriodMs: positiveInteger(
      policy.killGracePeriodMs ?? defaultKillGracePeriodMs,
      "killGracePeriodMs",
    ),
    maximumRestartDelayMs: positiveInteger(
      policy.maximumRestartDelayMs ?? defaultMaximumRestartDelayMs,
      "maximumRestartDelayMs",
    ),
    stableRunDurationMs: positiveInteger(
      policy.stableRunDurationMs ?? defaultStableRunDurationMs,
      "stableRunDurationMs",
    ),
    stopGracePeriodMs: positiveInteger(
      policy.stopGracePeriodMs ?? defaultStopGracePeriodMs,
      "stopGracePeriodMs",
    ),
  };
  if (normalized.maximumRestartDelayMs < normalized.initialRestartDelayMs) {
    throw new Error("maximumRestartDelayMs must not be shorter than initialRestartDelayMs.");
  }
  return normalized;
}

function restartDelay(
  failureCount: number,
  policy: NormalizedSupervisorPolicy,
): number {
  const exponent = Math.min(failureCount - 1, 30);
  return Math.min(
    policy.maximumRestartDelayMs,
    policy.initialRestartDelayMs * (2 ** exponent),
  );
}

function runtimeStateFor(
  phase: SupervisorPhase,
  hasActiveProcess: boolean,
): SafeTunnelRuntimeStatus["state"] {
  if (phase === "running" || (phase === "stopping" && hasActiveProcess)) return "running";
  if (phase === "starting" || phase === "retrying") return "unknown";
  return "stopped";
}

function startOutput(
  config: SafeTunnelPreparedTunnelConfig,
  managedFrpc: SafeTunnelManagedFrpc | undefined,
): string {
  return [
    frpcPreparationOutput(managedFrpc).trimEnd(),
    "Starting PI WEB-owned Safe Tunnel frpc supervision.",
    `Public URL: ${config.publicUrl}`,
    `Local target: ${config.localPiWebUrl}`,
    "",
  ].join("\n");
}

function frpcPreparationOutput(managedFrpc: SafeTunnelManagedFrpc | undefined): string {
  if (managedFrpc === undefined) return "Using an advanced frpc path override.";
  const target = `${managedFrpc.platform}-${managedFrpc.architecture}`;
  if (managedFrpc.source === "fallback") {
    const reason = managedFrpc.updateErrorCode ?? "install_failed";
    return `Managed frpc update was unavailable (${reason}); using verified fallback v${managedFrpc.version} for ${target}.`;
  }
  const action = managedFrpc.source === "installed" ? "Installed" : "Using";
  return `${action} verified PI WEB-managed frpc v${managedFrpc.version} for ${target}.`;
}

function unexpectedExitError(exit: SafeTunnelFrpcProcessExit): Error {
  if (exit.kind === "error") return new Error("The owned frpc process failed.");
  if (exit.signal !== null) {
    return new Error(`The owned frpc process exited unexpectedly after ${exit.signal}.`);
  }
  return new Error(
    `The owned frpc process exited unexpectedly with code ${exit.exitCode?.toString() ?? "unknown"}.`,
  );
}

function createStartLogHeader(now: Date, reason: string): string {
  return `\n=== ${now.toISOString()} PI WEB Safe Tunnel frpc ${reason} start ===\n`;
}

function formatDelay(milliseconds: number): string {
  if (milliseconds % 1_000 !== 0) return `${milliseconds.toString()} ms`;
  const seconds = milliseconds / 1_000;
  return `${seconds.toString()} ${seconds === 1 ? "second" : "seconds"}`;
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new SafeTunnelFrpcSupervisorError("start_cancelled"));
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      complete();
    };
    const onAbort = (): void => {
      finish(() => { reject(new SafeTunnelFrpcSupervisorError("start_cancelled")); });
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void operation.then(
      (value) => { finish(() => { resolve(value); }); },
      (error: unknown) => {
        finish(() => {
          reject(error instanceof Error ? error : new Error("Unexpected asynchronous failure."));
        });
      },
    );
  });
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function safeTunnelFrpcSupervisorErrorMessage(
  code: SafeTunnelFrpcSupervisorErrorCode,
  detailCode: string | undefined,
): string {
  switch (code) {
    case "already_running":
      return "Safe Tunnel frpc supervision is already active.";
    case "config_write_failed":
      return "PI WEB could not write the private Safe Tunnel frpc configuration.";
    case "frpc_acquisition_failed":
      return detailCode === undefined
        ? "PI WEB could not prepare a verified Safe Tunnel frpc executable."
        : `PI WEB could not prepare a verified Safe Tunnel frpc executable (${detailCode}).`;
    case "process_launch_failed":
      return "PI WEB could not launch the Safe Tunnel frpc process.";
    case "process_stop_failed":
      return "PI WEB could not confirm that its owned Safe Tunnel frpc process stopped.";
    case "start_cancelled":
      return "Safe Tunnel frpc start was cancelled.";
    case "supervisor_shutdown":
      return "Safe Tunnel frpc supervision has shut down.";
    case "tunnel_config_failed":
      return "PI WEB could not prepare Safe Tunnel configuration.";
  }
}
