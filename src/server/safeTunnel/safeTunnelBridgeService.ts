import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
  SafeTunnelCommandOutput,
  SafeTunnelConfigStatus,
  SafeTunnelLoginRequest,
  SafeTunnelLoginResponse,
  SafeTunnelOperationResponse,
  SafeTunnelRuntimeStatus,
  SafeTunnelStartRequest,
  SafeTunnelStartResponse,
  SafeTunnelStatusResponse,
  SafeTunnelStopResponse,
} from "../../shared/apiTypes.js";
import {
  HttpSafeTunnelControlPlane,
  type SafeTunnelDeviceAuthorization,
} from "./safeTunnelControlPlane.js";
import { SafeTunnelConnectorManager } from "./safeTunnelConnectorManager.js";
import {
  FileSafeTunnelStateStorage,
  defaultSafeTunnelStatePath,
  safeTunnelConnectorConfigPathEnvVar,
  type LoadedSafeTunnelState,
  type SafeTunnelPersistedState,
} from "./safeTunnelState.js";
import {
  SafeTunnelService,
  type SafeTunnelLoginInput,
  type SafeTunnelLoginObserver,
  type SafeTunnelLoginResult,
} from "./safeTunnelService.js";

const connectorPidFileName = "connector.pid";
const connectorFrpcConfigFileName = "frpc.toml";
const connectorLogFileName = "connector.log";
const connectorLogDirectoryMode = 0o700;
const connectorLogFileMode = 0o600;
const stopCommandTimeoutMs = 15_000;
const startCommandTimeoutMs = 0;
const maxCapturedOutputCharacters = 24_000;
const maxConnectorLogTailCharacters = 12_000;
const ansiEscapePattern = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "gu");

export interface SafeTunnelCommandInvocation {
  readonly args: readonly string[];
  readonly command: string;
}

export interface SafeTunnelCommandRunOptions {
  readonly maxOutputCharacters: number;
  readonly timeoutMs: number;
  readonly detached?: boolean;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly logHeader?: string;
  readonly logPath?: string;
  readonly onProcessId?: (processId: number) => void;
  readonly onStderr?: (chunk: string) => void;
  readonly onStdout?: (chunk: string) => void;
}

export interface SafeTunnelCommandRunResult extends SafeTunnelCommandOutput {
  readonly timedOut: boolean;
}

export interface SafeTunnelCommandRunner {
  run(invocation: SafeTunnelCommandInvocation, options: SafeTunnelCommandRunOptions): Promise<SafeTunnelCommandRunResult>;
}

export interface SafeTunnelBridgeService {
  status(): Promise<SafeTunnelStatusResponse>;
  login(request: SafeTunnelLoginRequest): Promise<SafeTunnelLoginResponse>;
  operation(operationId: string): SafeTunnelOperationResponse | undefined;
  start(request: SafeTunnelStartRequest): Promise<SafeTunnelStartResponse>;
  stop(): Promise<SafeTunnelStopResponse>;
}

export interface SafeTunnelApplicationService {
  readonly statePath: string;
  state(): Promise<LoadedSafeTunnelState>;
  login(request: SafeTunnelLoginInput, observer?: SafeTunnelLoginObserver): Promise<SafeTunnelLoginResult>;
  enable(frpcPath?: string): Promise<SafeTunnelPersistedState>;
  disable(): Promise<SafeTunnelPersistedState>;
}

export interface SafeTunnelBridgeDependencies {
  readonly commandRunner: SafeTunnelCommandRunner;
  readonly connectorCommandEnvironment: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fileExists: (path: string) => boolean;
  readonly homeDirectory: string;
  readonly now: () => Date;
  readonly platform: NodeJS.Platform;
  readonly safeTunnel: SafeTunnelApplicationService;
}

interface SafeTunnelOperationState {
  readonly id: string;
  readonly kind: "login" | "start";
  readonly startedAt: string;
  status: "running" | "succeeded" | "failed";
  stdout: string;
  stderr: string;
  connectorProcessId?: number;
  error?: string;
  exitCode?: number | null;
  finishedAt?: string;
  logPath?: string;
  logTail?: string;
  logTailMaxCharacters?: number;
  publicUrl?: string;
  signal?: string;
  userCode?: string;
  verificationUriComplete?: string;
}

export class SafeTunnelBridgeError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

/** Browser contract + temporary connector-runtime compatibility around PI WEB's application service. */
export class DefaultSafeTunnelBridgeService implements SafeTunnelBridgeService {
  private activeOperation: SafeTunnelOperationState | undefined;
  private operationStartInFlight = false;
  private readonly commandRunner: SafeTunnelCommandRunner;
  private readonly connectorManager: SafeTunnelConnectorManager;
  private readonly operations = new Map<string, SafeTunnelOperationState>();

  constructor(private readonly dependencies: SafeTunnelBridgeDependencies) {
    this.commandRunner = commandRunnerWithEnvironment(
      dependencies.commandRunner,
      dependencies.connectorCommandEnvironment,
    );
    this.connectorManager = new SafeTunnelConnectorManager({
      commandRunner: this.commandRunner,
      cwd: dependencies.cwd,
      env: dependencies.env,
      fileExists: dependencies.fileExists,
      homeDirectory: dependencies.homeDirectory,
      platform: dependencies.platform,
    });
  }

  async status(): Promise<SafeTunnelStatusResponse> {
    const [connectorProbe, ownedState] = await Promise.all([
      this.connectorManager.probeStatus(),
      this.readOwnedStateStatus(),
    ]);
    const runtime = connectorProbe.statusJson === undefined
      ? fallbackRuntimeStatus(this.dependencies.safeTunnel.statePath, "Connector runtime status is unavailable.", this.dependencies.fileExists)
      : parseConnectorRuntimeStatusOrFallback(
        connectorProbe.statusJson,
        this.dependencies.safeTunnel.statePath,
        this.dependencies.fileExists,
      );
    const activeOperation = this.activeOperation === undefined
      ? undefined
      : snapshotOperation(this.activeOperation);

    return {
      connector: connectorProbe.connector,
      config: ownedState.config,
      desiredState: ownedState.desiredState,
      runtime,
      ...(activeOperation === undefined ? {} : { activeOperation }),
    };
  }

  async login(request: SafeTunnelLoginRequest): Promise<SafeTunnelLoginResponse> {
    this.assertNoActiveOperation();
    this.operationStartInFlight = true;
    try {
      const operation = this.createOperation("login");
      void this.dependencies.safeTunnel.login({
        controlApiBaseUrl: request.controlApiUrl,
        machineName: request.machineName,
        machineSlug: request.machineSlug,
        ...(request.localPiWebUrl === undefined ? {} : { localPiWebUrl: request.localPiWebUrl }),
        ...(request.frpcPath === undefined ? {} : { frpcPath: request.frpcPath }),
      }, loginObserver(operation)).then(
        (result) => {
          finishLoginOperation(operation, result, this.dependencies.now());
          this.clearActiveOperation(operation);
        },
        (error: unknown) => {
          this.failOperation(operation, error);
        },
      );

      return {
        operation: snapshotOperation(operation),
        status: await this.status(),
      };
    } finally {
      this.operationStartInFlight = false;
    }
  }

  operation(operationId: string): SafeTunnelOperationResponse | undefined {
    const operation = this.operations.get(operationId);
    return operation === undefined ? undefined : snapshotOperation(operation);
  }

  async start(request: SafeTunnelStartRequest): Promise<SafeTunnelStartResponse> {
    this.assertNoActiveOperation();
    this.operationStartInFlight = true;
    try {
      const currentStatus = await this.status();
      if (currentStatus.runtime.state === "running") {
        throw new SafeTunnelBridgeError("The PI WEB Safe Tunnel connector is already running.", 409);
      }
      if (currentStatus.config.state !== "registered") {
        throw new SafeTunnelBridgeError("Register or log in to PI WEB Safe Tunnels before starting the connector.", 409);
      }
      if (request.frpcPath === undefined && currentStatus.config.frpcPathConfigured !== true) {
        throw new SafeTunnelBridgeError("Configure an frpc executable path before starting the connector.", 400);
      }

      const command = await this.connectorManager.ensureCommand();
      await this.dependencies.safeTunnel.enable(request.frpcPath);
      const invocation: SafeTunnelCommandInvocation = { command, args: startArgs(request) };
      const logHeader = createConnectorStartLogHeader(this.dependencies.now(), invocation);
      const logPath = currentStatus.runtime.logPath
        ?? runtimePath(this.dependencies.safeTunnel.statePath, connectorLogFileName);
      const operation = this.createOperation("start", {
        logPath,
        logTail: tailText(sanitizeConnectorLog(logHeader), maxConnectorLogTailCharacters),
        logTailMaxCharacters: maxConnectorLogTailCharacters,
      });

      void this.commandRunner.run(invocation, {
        detached: true,
        logHeader,
        logPath,
        maxOutputCharacters: maxCapturedOutputCharacters,
        timeoutMs: startCommandTimeoutMs,
        onProcessId: (processId) => {
          operation.connectorProcessId = processId;
        },
        onStdout: (chunk) => {
          appendOperationStdout(operation, chunk);
          appendOperationLogTail(operation, chunk);
        },
        onStderr: (chunk) => {
          appendOperationStderr(operation, chunk);
          appendOperationLogTail(operation, chunk);
        },
      }).then(
        (result) => {
          this.finishCommandOperation(operation, result);
        },
        (error: unknown) => {
          this.failOperation(operation, error);
        },
      );

      return {
        accepted: true,
        operation: snapshotOperation(operation),
        ...(operation.connectorProcessId === undefined ? {} : { connectorProcessId: operation.connectorProcessId }),
        status: await this.status(),
      };
    } finally {
      this.operationStartInFlight = false;
    }
  }

  async stop(): Promise<SafeTunnelStopResponse> {
    await this.dependencies.safeTunnel.disable();
    const command = await this.connectorManager.ensureCommand();
    const result = await this.commandRunner.run({ command, args: ["stop"] }, {
      maxOutputCharacters: maxCapturedOutputCharacters,
      timeoutMs: stopCommandTimeoutMs,
    });
    return { command: commandOutput(result), status: await this.status() };
  }

  private assertNoActiveOperation(): void {
    if (this.operationStartInFlight || this.activeOperation?.status === "running") {
      throw new SafeTunnelBridgeError("A Safe Tunnel operation is already running.", 409);
    }
  }

  private createOperation(
    kind: SafeTunnelOperationState["kind"],
    initial: Partial<SafeTunnelOperationState> = {},
  ): SafeTunnelOperationState {
    const operation: SafeTunnelOperationState = {
      id: randomUUID(),
      kind,
      startedAt: this.dependencies.now().toISOString(),
      status: "running",
      stdout: "",
      stderr: "",
      ...initial,
    };
    this.activeOperation = operation;
    this.operations.set(operation.id, operation);
    return operation;
  }

  private finishCommandOperation(
    operation: SafeTunnelOperationState,
    result: SafeTunnelCommandRunResult,
  ): void {
    operation.stdout = result.stdout;
    operation.stderr = result.stderr;
    operation.exitCode = result.exitCode;
    operation.finishedAt = this.dependencies.now().toISOString();
    if (result.signal !== undefined) operation.signal = result.signal;
    updateOperationDerivedFields(operation);

    if (result.exitCode === 0 && !result.timedOut) {
      operation.status = "succeeded";
    } else {
      operation.status = "failed";
      operation.error = result.timedOut
        ? "Safe Tunnel start timed out."
        : `Safe Tunnel start exited with code ${formatExitCode(result.exitCode)}.`;
    }
    this.clearActiveOperation(operation);
  }

  private failOperation(operation: SafeTunnelOperationState, error: unknown): void {
    operation.status = "failed";
    operation.error = safeErrorMessage(error);
    operation.finishedAt = this.dependencies.now().toISOString();
    this.clearActiveOperation(operation);
  }

  private clearActiveOperation(operation: SafeTunnelOperationState): void {
    if (this.activeOperation?.id === operation.id) this.activeOperation = undefined;
  }

  private async readOwnedStateStatus(): Promise<{
    readonly config: SafeTunnelConfigStatus;
    readonly desiredState: SafeTunnelStatusResponse["desiredState"];
  }> {
    try {
      const loaded = await this.dependencies.safeTunnel.state();
      return {
        config: configStatusFromOwnedState(this.dependencies.safeTunnel.statePath, loaded),
        desiredState: loaded.state.desiredState,
      };
    } catch (error: unknown) {
      return {
        config: {
          path: this.dependencies.safeTunnel.statePath,
          exists: this.dependencies.fileExists(this.dependencies.safeTunnel.statePath),
          state: "invalid",
          error: `Unable to read PI WEB Safe Tunnel state: ${safeErrorMessage(error)}`,
        },
        desiredState: "disabled",
      };
    }
  }
}

export function createDefaultSafeTunnelBridgeService(): SafeTunnelBridgeService {
  const statePath = defaultSafeTunnelStatePath();
  const safeTunnel = new SafeTunnelService({
    controlPlane: new HttpSafeTunnelControlPlane(),
    stateStorage: new FileSafeTunnelStateStorage({ filePath: statePath }),
  });
  return new DefaultSafeTunnelBridgeService({
    commandRunner: createNodeSafeTunnelCommandRunner(),
    connectorCommandEnvironment: { [safeTunnelConnectorConfigPathEnvVar]: statePath },
    cwd: process.cwd(),
    env: process.env,
    fileExists: existsSync,
    homeDirectory: homedir(),
    now: () => new Date(),
    platform: process.platform,
    safeTunnel,
  });
}

export function createNodeSafeTunnelCommandRunner(): SafeTunnelCommandRunner {
  return { run: (invocation, options) => runNodeCommand(invocation, options) };
}

function runNodeCommand(
  invocation: SafeTunnelCommandInvocation,
  options: SafeTunnelCommandRunOptions,
): Promise<SafeTunnelCommandRunResult> {
  return new Promise((resolve, reject) => {
    let logFileDescriptor: number | undefined;
    try {
      logFileDescriptor = openConnectorLogFile(options);
      const child = spawn(invocation.command, [...invocation.args], {
        detached: options.detached === true,
        env: mergedCommandEnvironment(options.environment),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;
      const timeout = options.timeoutMs > 0
        ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, options.timeoutMs)
        : undefined;

      if (child.pid !== undefined) options.onProcessId?.(child.pid);
      const closeLog = (): void => {
        closeFileDescriptor(logFileDescriptor);
        logFileDescriptor = undefined;
      };
      const settle = (finish: () => void): void => {
        if (settled) return;
        settled = true;
        if (timeout !== undefined) clearTimeout(timeout);
        closeLog();
        finish();
      };
      const writeLogChunk = (chunk: string): void => {
        if (logFileDescriptor === undefined) return;
        try {
          writeSync(logFileDescriptor, chunk);
        } catch {
          closeLog();
        }
      };

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout = appendCapped(stdout, chunk, options.maxOutputCharacters);
        writeLogChunk(chunk);
        options.onStdout?.(chunk);
      });
      child.stderr.on("data", (chunk: string) => {
        stderr = appendCapped(stderr, chunk, options.maxOutputCharacters);
        writeLogChunk(chunk);
        options.onStderr?.(chunk);
      });
      child.once("error", (error) => {
        settle(() => { reject(error); });
      });
      child.once("close", (exitCode, signal) => {
        settle(() => {
          resolve({
            exitCode,
            stdout,
            stderr,
            timedOut,
            ...(signal === null ? {} : { signal }),
          });
        });
      });
    } catch (error: unknown) {
      closeFileDescriptor(logFileDescriptor);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function commandRunnerWithEnvironment(
  commandRunner: SafeTunnelCommandRunner,
  environment: Readonly<Record<string, string | undefined>>,
): SafeTunnelCommandRunner {
  return {
    run(invocation, options) {
      return commandRunner.run(invocation, { ...options, environment });
    },
  };
}

function mergedCommandEnvironment(
  overrides: Readonly<Record<string, string | undefined>> | undefined,
): NodeJS.ProcessEnv {
  const entries = new Map(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value === undefined) entries.delete(key);
    else entries.set(key, value);
  }
  return Object.fromEntries(entries);
}

function loginObserver(operation: SafeTunnelOperationState): SafeTunnelLoginObserver {
  return {
    onDeviceAuthorization(authorization) {
      operation.verificationUriComplete = authorization.verificationUriComplete;
      operation.userCode = authorization.userCode;
      appendOperationStdout(operation, loginApprovalOutput(authorization));
    },
    onAuthorizationApproved(account) {
      appendOperationStdout(
        operation,
        `Connector authorization approved.\nAccount namespace: ${account.publicNamespace}\nRegistering this machine...\n`,
      );
    },
    onMachineRegistered(machine) {
      operation.publicUrl = machine.publicUrl;
    },
  };
}

function loginApprovalOutput(authorization: SafeTunnelDeviceAuthorization): string {
  return [
    "Starting PI WEB Safe Tunnel login.",
    "Open this URL to authorize the connector:",
    authorization.verificationUriComplete,
    `User code: ${authorization.userCode}`,
    `Waiting for approval until ${authorization.expiresAt}...`,
    "",
  ].join("\n");
}

function finishLoginOperation(
  operation: SafeTunnelOperationState,
  result: SafeTunnelLoginResult,
  now: Date,
): void {
  operation.publicUrl = result.registeredMachine.publicUrl;
  appendOperationStdout(
    operation,
    `Logged in and registered this machine for PI WEB Safe Tunnels.\nMachine id: ${result.registeredMachine.machine.id}\nPublic URL: ${result.registeredMachine.publicUrl}\n`,
  );
  operation.status = "succeeded";
  operation.exitCode = 0;
  operation.finishedAt = now.toISOString();
}

function configStatusFromOwnedState(
  statePath: string,
  loaded: LoadedSafeTunnelState,
): SafeTunnelConfigStatus {
  const state = loaded.state;
  return {
    path: statePath,
    exists: loaded.exists,
    state: state.machine === undefined ? (loaded.exists ? "unregistered" : "missing") : "registered",
    localPiWebUrl: state.localPiWebUrl,
    frpcPathConfigured: state.frpcPath !== undefined,
    ...(state.machine === undefined ? {} : {
      machine: {
        controlApiBaseUrl: state.machine.controlApiBaseUrl,
        machineId: state.machine.machineId,
        ...(state.machine.machineSlug === undefined ? {} : { machineSlug: state.machine.machineSlug }),
        ...(state.machine.publicUrl === undefined ? {} : {
          publicHostname: publicHostnameFromUrl(state.machine.publicUrl),
          publicUrl: state.machine.publicUrl,
        }),
      },
    }),
  };
}

function parseConnectorRuntimeStatusOrFallback(
  statusJson: string,
  statePath: string,
  fileExists: (path: string) => boolean,
): SafeTunnelRuntimeStatus {
  try {
    const record = requireRecord(JSON.parse(statusJson));
    if (record["statusVersion"] !== 1) throw new Error("Unsupported connector status version");
    return parseConnectorRuntimeStatus(record["runtime"], record["log"]);
  } catch (error: unknown) {
    return fallbackRuntimeStatus(
      statePath,
      `Unable to parse connector runtime status: ${safeErrorMessage(error)}`,
      fileExists,
      true,
    );
  }
}

function parseConnectorRuntimeStatus(runtimeValue: unknown, logValue: unknown): SafeTunnelRuntimeStatus {
  const runtime = requireRecord(runtimeValue);
  const log = requireRecord(logValue);
  const state = requireRuntimeState(runtime["state"]);
  const pid = optionalFiniteNumber(runtime["pid"]);
  const runtimeError = optionalNonEmptyString(runtime["error"]);
  const logTail = optionalString(log["tail"]);
  const logError = optionalNonEmptyString(log["error"]);
  return {
    pidFilePath: requireNonEmptyString(runtime["pidFilePath"]),
    frpcConfigPath: requireNonEmptyString(runtime["frpcConfigPath"]),
    frpcConfigExists: requireBoolean(runtime["frpcConfigExists"]),
    state,
    ...(pid === undefined ? {} : { pid }),
    ...(runtimeError === undefined ? {} : { error: runtimeError }),
    logPath: requireNonEmptyString(log["path"]),
    logExists: requireBoolean(log["exists"]),
    logTailMaxCharacters: requireFiniteNumber(log["tailMaxCharacters"]),
    ...(logError === undefined ? {} : { logError }),
    ...(logTail === undefined || logTail === "" ? {} : {
      logTail: tailText(sanitizeConnectorLog(logTail), maxConnectorLogTailCharacters),
    }),
  };
}

function fallbackRuntimeStatus(
  statePath: string,
  reason: string,
  fileExists: (path: string) => boolean,
  forceError = false,
): SafeTunnelRuntimeStatus {
  const pidFilePath = runtimePath(statePath, connectorPidFileName);
  const logPath = runtimePath(statePath, connectorLogFileName);
  const pidExists = fileExists(pidFilePath);
  return {
    pidFilePath,
    frpcConfigPath: runtimePath(statePath, connectorFrpcConfigFileName),
    frpcConfigExists: fileExists(runtimePath(statePath, connectorFrpcConfigFileName)),
    state: pidExists || forceError ? "unknown" : "stopped",
    ...(pidExists || forceError ? { error: reason } : {}),
    logPath,
    logExists: fileExists(logPath),
    logTailMaxCharacters: maxConnectorLogTailCharacters,
  };
}

function startArgs(request: SafeTunnelStartRequest): string[] {
  return ["start", ...(request.frpcPath === undefined ? [] : ["--frpc-path", request.frpcPath])];
}

function createConnectorStartLogHeader(now: Date, invocation: SafeTunnelCommandInvocation): string {
  return `\n=== ${now.toISOString()} ${invocation.command} ${invocation.args.join(" ")} ===\n`;
}

function openConnectorLogFile(
  options: Pick<SafeTunnelCommandRunOptions, "logHeader" | "logPath">,
): number | undefined {
  if (options.logPath === undefined) return undefined;
  mkdirSync(dirname(options.logPath), { mode: connectorLogDirectoryMode, recursive: true });
  if (process.platform !== "win32") chmodSync(dirname(options.logPath), connectorLogDirectoryMode);
  const fileDescriptor = openSync(options.logPath, "w", connectorLogFileMode);
  if (process.platform !== "win32") chmodSync(options.logPath, connectorLogFileMode);
  if (options.logHeader !== undefined) writeSync(fileDescriptor, options.logHeader);
  return fileDescriptor;
}

function closeFileDescriptor(fileDescriptor: number | undefined): void {
  if (fileDescriptor !== undefined) closeSync(fileDescriptor);
}

function runtimePath(statePath: string, fileName: string): string {
  return join(dirname(statePath), fileName);
}

function publicHostnameFromUrl(publicUrl: string): string {
  return new URL(publicUrl).hostname;
}

function snapshotOperation(operation: SafeTunnelOperationState): SafeTunnelOperationResponse {
  return {
    id: operation.id,
    kind: operation.kind,
    startedAt: operation.startedAt,
    status: operation.status,
    stdout: operation.stdout,
    stderr: operation.stderr,
    ...(operation.connectorProcessId === undefined ? {} : { connectorProcessId: operation.connectorProcessId }),
    ...(operation.error === undefined ? {} : { error: operation.error }),
    ...(operation.exitCode === undefined ? {} : { exitCode: operation.exitCode }),
    ...(operation.finishedAt === undefined ? {} : { finishedAt: operation.finishedAt }),
    ...(operation.logPath === undefined ? {} : { logPath: operation.logPath }),
    ...(operation.logTail === undefined || operation.logTail === "" ? {} : { logTail: operation.logTail }),
    ...(operation.logTailMaxCharacters === undefined ? {} : { logTailMaxCharacters: operation.logTailMaxCharacters }),
    ...(operation.publicUrl === undefined ? {} : { publicUrl: operation.publicUrl }),
    ...(operation.signal === undefined ? {} : { signal: operation.signal }),
    ...(operation.userCode === undefined ? {} : { userCode: operation.userCode }),
    ...(operation.verificationUriComplete === undefined ? {} : { verificationUriComplete: operation.verificationUriComplete }),
  };
}

function appendOperationStdout(operation: SafeTunnelOperationState, chunk: string): void {
  operation.stdout = appendCapped(operation.stdout, chunk, maxCapturedOutputCharacters);
  updateOperationDerivedFields(operation);
}

function appendOperationStderr(operation: SafeTunnelOperationState, chunk: string): void {
  operation.stderr = appendCapped(operation.stderr, chunk, maxCapturedOutputCharacters);
}

function appendOperationLogTail(operation: SafeTunnelOperationState, chunk: string): void {
  operation.logTail = tailText(
    sanitizeConnectorLog(`${operation.logTail ?? ""}${chunk}`),
    maxConnectorLogTailCharacters,
  );
  operation.logTailMaxCharacters = maxConnectorLogTailCharacters;
}

function updateOperationDerivedFields(operation: SafeTunnelOperationState): void {
  for (const line of operation.stdout.split(/\r?\n/u)) {
    const normalized = line.trim();
    if (normalized.startsWith("Public URL:")) {
      operation.publicUrl = normalized.slice("Public URL:".length).trim();
    }
  }
}

function commandOutput(result: SafeTunnelCommandRunResult): SafeTunnelCommandOutput {
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    ...(result.signal === undefined ? {} : { signal: result.signal }),
  };
}

function appendCapped(existing: string, chunk: string, maxCharacters: number): string {
  const next = `${existing}${chunk}`;
  return next.length <= maxCharacters ? next : next.slice(next.length - maxCharacters);
}

function sanitizeConnectorLog(contents: string): string {
  return contents.replace(ansiEscapePattern, "");
}

function tailText(contents: string, maxCharacters: number): string {
  return contents.length <= maxCharacters ? contents : contents.slice(contents.length - maxCharacters);
}

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new Error("Expected a JSON object");
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error("Expected a non-empty string");
  return value;
}

function optionalNonEmptyString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return requireNonEmptyString(value);
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("Expected a string");
  return value;
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Expected a boolean");
  return value;
}

function requireFiniteNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Expected a finite number");
  return value;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return value === undefined ? undefined : requireFiniteNumber(value);
}

function requireRuntimeState(value: unknown): SafeTunnelRuntimeStatus["state"] {
  if (value !== "stopped" && value !== "running" && value !== "stale" && value !== "unknown") {
    throw new Error("Invalid connector runtime state");
  }
  return value;
}

function formatExitCode(exitCode: number | null): string {
  return exitCode === null ? "unknown" : exitCode.toString();
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected Safe Tunnel failure";
}
