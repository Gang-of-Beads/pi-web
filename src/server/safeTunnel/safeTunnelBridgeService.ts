import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type {
  SafeTunnelConfigStatus,
  SafeTunnelConnectorStatus,
  SafeTunnelLoginRequest,
  SafeTunnelLoginResponse,
  SafeTunnelOperationResponse,
  SafeTunnelStartRequest,
  SafeTunnelStartResponse,
  SafeTunnelStatusResponse,
  SafeTunnelStopResponse,
} from "../../shared/apiTypes.js";
import {
  HttpSafeTunnelControlPlane,
  type SafeTunnelDeviceAuthorization,
  type SafeTunnelHeartbeatTunnelStatus,
  type SafeTunnelMachineHeartbeat,
} from "./safeTunnelControlPlane.js";
import {
  defaultSafeTunnelFrpcInstallDirectory,
  HttpSafeTunnelFrpcArtifactSource,
  SafeTunnelFrpcManager,
} from "./safeTunnelFrpcManager.js";
import { NodeSafeTunnelFrpcProcessLauncher } from "./safeTunnelFrpcProcess.js";
import {
  FileSafeTunnelFrpcRuntimeFiles,
} from "./safeTunnelFrpcRuntimeFiles.js";
import {
  NodeSafeTunnelSupervisorClock,
  SafeTunnelFrpcSupervisor,
  type SafeTunnelFrpcStartResult,
} from "./safeTunnelFrpcSupervisor.js";
import {
  SafeTunnelRuntimeReconciler,
  type SafeTunnelReconciledFrpcRuntime,
} from "./safeTunnelRuntimeReconciler.js";
import {
  FileSafeTunnelStateStorage,
  defaultSafeTunnelStatePath,
  type LoadedSafeTunnelState,
  type SafeTunnelPersistedState,
} from "./safeTunnelState.js";
import {
  SafeTunnelService,
  type SafeTunnelLoginInput,
  type SafeTunnelLoginObserver,
  type SafeTunnelLoginResult,
  type SafeTunnelPreparedTunnelConfig,
} from "./safeTunnelService.js";

const maxCapturedOutputCharacters = 24_000;
const maxFrpcLogTailCharacters = 12_000;

export interface SafeTunnelBridgeService {
  login(request: SafeTunnelLoginRequest): Promise<SafeTunnelLoginResponse>;
  operation(operationId: string): SafeTunnelOperationResponse | undefined;
  shutdown(): Promise<void>;
  startup(): Promise<void>;
  start(request: SafeTunnelStartRequest): Promise<SafeTunnelStartResponse>;
  status(): Promise<SafeTunnelStatusResponse>;
  stop(): Promise<SafeTunnelStopResponse>;
}

export interface SafeTunnelApplicationService {
  readonly statePath: string;
  disable(): Promise<SafeTunnelPersistedState>;
  enable(frpcPath?: string): Promise<SafeTunnelPersistedState>;
  getTunnelConfig(options?: {
    readonly signal?: AbortSignal;
  }): Promise<SafeTunnelPreparedTunnelConfig>;
  recordHeartbeat(
    input: {
      readonly tunnelStatus: SafeTunnelHeartbeatTunnelStatus;
      readonly errorMessage?: string;
    },
    options?: { readonly signal?: AbortSignal },
  ): Promise<SafeTunnelMachineHeartbeat>;
  login(
    request: SafeTunnelLoginInput,
    observer?: SafeTunnelLoginObserver,
  ): Promise<SafeTunnelLoginResult>;
  state(): Promise<LoadedSafeTunnelState>;
}

export interface SafeTunnelBridgeDependencies {
  readonly fileExists: (path: string) => boolean;
  readonly now: () => Date;
  readonly runtime: SafeTunnelReconciledFrpcRuntime;
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

/** Browser contract around PI WEB-owned state, Control API, and direct frpc supervision. */
export class DefaultSafeTunnelBridgeService implements SafeTunnelBridgeService {
  private activeOperation: SafeTunnelOperationState | undefined;
  private operationStartInFlight = false;
  private readonly operations = new Map<string, SafeTunnelOperationState>();

  constructor(private readonly dependencies: SafeTunnelBridgeDependencies) {}

  async status(): Promise<SafeTunnelStatusResponse> {
    const [runtime, ownedState] = await Promise.all([
      this.dependencies.runtime.status(),
      this.readOwnedStateStatus(),
    ]);
    const activeOperation = this.activeOperation === undefined
      ? undefined
      : snapshotOperation(this.activeOperation);

    return {
      connector: builtInConnectorStatus(),
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
        ...(request.localPiWebUrl === undefined
          ? {}
          : { localPiWebUrl: request.localPiWebUrl }),
        ...(request.frpcPath === undefined ? {} : { frpcPath: request.frpcPath }),
      }, loginObserver(operation)).then(
        (result) => {
          finishLoginOperation(operation, result, this.dependencies.now());
          this.clearActiveOperation(operation);
          void this.dependencies.runtime.reconcile().catch(() => undefined);
        },
        (error: unknown) => { this.failOperation(operation, error); },
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
        throw new SafeTunnelBridgeError(
          "The PI WEB Safe Tunnel frpc process is already running.",
          409,
        );
      }
      if (currentStatus.config.state !== "registered") {
        throw new SafeTunnelBridgeError(
          "Register or log in to PI WEB Safe Tunnels before starting the tunnel.",
          409,
        );
      }

      const loadedState = await this.dependencies.safeTunnel.state();
      const advancedFrpcPath = request.frpcPath ?? loadedState.state.frpcPath;
      await this.dependencies.safeTunnel.enable(request.frpcPath);
      const operation = this.createOperation("start", {
        ...(currentStatus.runtime.logPath === undefined
          ? {}
          : { logPath: currentStatus.runtime.logPath }),
        logTailMaxCharacters: maxFrpcLogTailCharacters,
      });

      void this.dependencies.runtime.start({
        ...(advancedFrpcPath === undefined ? {} : { advancedFrpcPath }),
      }).then(
        (result) => {
          finishStartOperation(operation, result, this.dependencies.now());
          this.clearActiveOperation(operation);
        },
        (error: unknown) => { this.failOperation(operation, error); },
      );

      const status = await this.status();
      const snapshot = snapshotOperation(operation);
      return {
        accepted: true,
        operation: snapshot,
        ...(snapshot.connectorProcessId === undefined
          ? {}
          : { connectorProcessId: snapshot.connectorProcessId }),
        status,
      };
    } finally {
      this.operationStartInFlight = false;
    }
  }

  async stop(): Promise<SafeTunnelStopResponse> {
    let disableError: unknown;
    let disableFailed = false;
    try {
      await this.dependencies.safeTunnel.disable();
    } catch (error: unknown) {
      disableFailed = true;
      disableError = error;
    }

    const result = await this.dependencies.runtime.stop();
    if (disableFailed) throw disableError;
    return { command: result, status: await this.status() };
  }

  shutdown(): Promise<void> {
    return this.dependencies.runtime.shutdown();
  }

  startup(): Promise<void> {
    return this.dependencies.runtime.startup();
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
      stderr: "",
      stdout: "",
      ...initial,
    };
    this.activeOperation = operation;
    this.operations.set(operation.id, operation);
    return operation;
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
        config: configStatusFromOwnedState(
          this.dependencies.safeTunnel.statePath,
          loaded,
        ),
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
  const managedFrpc = new SafeTunnelFrpcManager({
    artifactSource: new HttpSafeTunnelFrpcArtifactSource(),
    installDirectory: defaultSafeTunnelFrpcInstallDirectory(statePath),
  });
  const clock = new NodeSafeTunnelSupervisorClock();
  const supervisor = new SafeTunnelFrpcSupervisor({
    clock,
    configProvider: safeTunnel,
    files: new FileSafeTunnelFrpcRuntimeFiles({ statePath }),
    launcher: new NodeSafeTunnelFrpcProcessLauncher(),
    managedFrpc,
  });
  const runtime = new SafeTunnelRuntimeReconciler({
    clock,
    runtime: supervisor,
    safeTunnel,
  });
  return new DefaultSafeTunnelBridgeService({
    fileExists: existsSync,
    now: () => new Date(),
    runtime,
    safeTunnel,
  });
}

function builtInConnectorStatus(): SafeTunnelConnectorStatus {
  return {
    command: "PI WEB built-in frpc supervisor",
    state: "available",
  };
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

function finishStartOperation(
  operation: SafeTunnelOperationState,
  result: SafeTunnelFrpcStartResult,
  now: Date,
): void {
  appendOperationStdout(operation, result.output);
  operation.publicUrl = result.publicUrl;
  if (result.pid !== undefined) operation.connectorProcessId = result.pid;
  operation.status = "succeeded";
  operation.exitCode = 0;
  operation.finishedAt = now.toISOString();
  operation.logTail = tailText(result.output, maxFrpcLogTailCharacters);
}

function configStatusFromOwnedState(
  statePath: string,
  loaded: LoadedSafeTunnelState,
): SafeTunnelConfigStatus {
  const state = loaded.state;
  return {
    path: statePath,
    exists: loaded.exists,
    state: state.machine === undefined
      ? (loaded.exists ? "unregistered" : "missing")
      : "registered",
    localPiWebUrl: state.localPiWebUrl,
    frpcPathConfigured: state.frpcPath !== undefined,
    ...(state.machine === undefined ? {} : {
      machine: {
        controlApiBaseUrl: state.machine.controlApiBaseUrl,
        machineId: state.machine.machineId,
        ...(state.machine.machineSlug === undefined
          ? {}
          : { machineSlug: state.machine.machineSlug }),
        ...(state.machine.publicUrl === undefined ? {} : {
          publicHostname: publicHostnameFromUrl(state.machine.publicUrl),
          publicUrl: state.machine.publicUrl,
        }),
      },
    }),
  };
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
    ...(operation.connectorProcessId === undefined
      ? {}
      : { connectorProcessId: operation.connectorProcessId }),
    ...(operation.error === undefined ? {} : { error: operation.error }),
    ...(operation.exitCode === undefined ? {} : { exitCode: operation.exitCode }),
    ...(operation.finishedAt === undefined ? {} : { finishedAt: operation.finishedAt }),
    ...(operation.logPath === undefined ? {} : { logPath: operation.logPath }),
    ...(operation.logTail === undefined || operation.logTail === ""
      ? {}
      : { logTail: operation.logTail }),
    ...(operation.logTailMaxCharacters === undefined
      ? {}
      : { logTailMaxCharacters: operation.logTailMaxCharacters }),
    ...(operation.publicUrl === undefined ? {} : { publicUrl: operation.publicUrl }),
    ...(operation.signal === undefined ? {} : { signal: operation.signal }),
    ...(operation.userCode === undefined ? {} : { userCode: operation.userCode }),
    ...(operation.verificationUriComplete === undefined
      ? {}
      : { verificationUriComplete: operation.verificationUriComplete }),
  };
}

function appendOperationStdout(operation: SafeTunnelOperationState, chunk: string): void {
  operation.stdout = appendCapped(
    operation.stdout,
    chunk,
    maxCapturedOutputCharacters,
  );
}

function appendCapped(existing: string, chunk: string, maxCharacters: number): string {
  const next = `${existing}${chunk}`;
  return next.length <= maxCharacters
    ? next
    : next.slice(next.length - maxCharacters);
}

function tailText(contents: string, maxCharacters: number): string {
  return contents.length <= maxCharacters
    ? contents
    : contents.slice(contents.length - maxCharacters);
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected Safe Tunnel failure";
}
