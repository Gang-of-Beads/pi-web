import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type {
  SafeTunnelConfigStatus,
  SafeTunnelDisableResponse,
  SafeTunnelEnableRequest,
  SafeTunnelEnableResponse,
  SafeTunnelOperationResponse,
  SafeTunnelStatusResponse,
} from "../../shared/apiTypes.js";
import {
  HttpSafeTunnelControlPlane,
  type SafeTunnelDeviceAuthorization,
  type SafeTunnelHeartbeatTunnelStatus,
  type SafeTunnelMachineHeartbeat,
} from "./safeTunnelControlPlane.js";
import {
  createNodeSafeTunnelEnableDefaultsProvider,
  type SafeTunnelEnableDefaults,
  type SafeTunnelServerAddress,
} from "./safeTunnelEnableDefaults.js";
import {
  defaultSafeTunnelFrpcInstallDirectory,
  HttpSafeTunnelFrpcArtifactSource,
  SafeTunnelFrpcManager,
} from "./safeTunnelFrpcManager.js";
import { NodeSafeTunnelFrpcProcessLauncher } from "./safeTunnelFrpcProcess.js";
import { FileSafeTunnelFrpcRuntimeFiles } from "./safeTunnelFrpcRuntimeFiles.js";
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
  type SafeTunnelEnableInput,
  type SafeTunnelLoginInput,
  type SafeTunnelLoginObserver,
  type SafeTunnelLoginOptions,
  type SafeTunnelLoginResult,
  type SafeTunnelPreparedTunnelConfig,
} from "./safeTunnelService.js";

const maxCapturedOutputCharacters = 24_000;
const maxFrpcLogTailCharacters = 12_000;
const enableCancelledMessage = "Safe Tunnel enablement was cancelled.";

export interface SafeTunnelBridgeService {
  disable(): Promise<SafeTunnelDisableResponse>;
  enable(request: SafeTunnelEnableRequest): Promise<SafeTunnelEnableResponse>;
  operation(operationId: string): SafeTunnelOperationResponse | undefined;
  shutdown(): Promise<void>;
  startup(): Promise<void>;
  status(): Promise<SafeTunnelStatusResponse>;
}

export interface SafeTunnelApplicationService {
  readonly statePath: string;
  disable(): Promise<SafeTunnelPersistedState>;
  enable(input?: SafeTunnelEnableInput): Promise<SafeTunnelPersistedState>;
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
    options?: SafeTunnelLoginOptions,
  ): Promise<SafeTunnelLoginResult>;
  state(): Promise<LoadedSafeTunnelState>;
}

export interface SafeTunnelBridgeDependencies {
  readonly enableDefaults: () => SafeTunnelEnableDefaults;
  readonly fileExists: (path: string) => boolean;
  readonly now: () => Date;
  readonly runtime: SafeTunnelReconciledFrpcRuntime;
  readonly safeTunnel: SafeTunnelApplicationService;
}

interface SafeTunnelOperationState {
  readonly id: string;
  readonly kind: "enable";
  readonly startedAt: string;
  phase: SafeTunnelOperationResponse["phase"];
  status: SafeTunnelOperationResponse["status"];
  stdout: string;
  stderr: string;
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

interface ActiveEnableWorkflow {
  readonly controller: AbortController;
  readonly operation: SafeTunnelOperationState;
  readonly promise: Promise<void>;
}

export class SafeTunnelBridgeError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

/** Browser contract around PI WEB-owned state, Control API, and direct frpc supervision. */
export class DefaultSafeTunnelBridgeService implements SafeTunnelBridgeService {
  private activeOperation: SafeTunnelOperationState | undefined;
  private activeWorkflow: ActiveEnableWorkflow | undefined;
  private enableRequestController: AbortController | undefined;
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
      config: ownedState.config,
      desiredState: ownedState.desiredState,
      runtime,
      ...(activeOperation === undefined ? {} : { activeOperation }),
    };
  }

  async enable(request: SafeTunnelEnableRequest): Promise<SafeTunnelEnableResponse> {
    this.assertNoActiveOperation();
    this.operationStartInFlight = true;
    const controller = new AbortController();
    this.enableRequestController = controller;
    try {
      const [currentStatus, loadedState] = await Promise.all([
        this.status(),
        this.dependencies.safeTunnel.state(),
      ]);
      throwIfEnableCancelled(controller.signal);
      if (currentStatus.runtime.state === "running") {
        throw new SafeTunnelBridgeError("Safe Tunnel is already enabled.", 409);
      }

      const defaults = this.dependencies.enableDefaults();
      throwIfEnableCancelled(controller.signal);
      const operation = this.createOperation();
      const promise = this.runEnableWorkflow(
        request,
        loadedState,
        currentStatus,
        defaults,
        operation,
        controller.signal,
      ).then(
        (result) => { finishEnableOperation(operation, result, this.dependencies.now()); },
        (error: unknown) => { this.failOperation(operation, error, controller.signal); },
      ).finally(() => {
        const active = this.activeWorkflow;
        if (active?.operation.id === operation.id) this.activeWorkflow = undefined;
        this.clearActiveOperation(operation);
      });
      this.activeWorkflow = { controller, operation, promise };

      return {
        accepted: true,
        operation: snapshotOperation(operation),
        status: await this.status(),
      };
    } finally {
      if (this.enableRequestController === controller) {
        this.enableRequestController = undefined;
      }
      this.operationStartInFlight = false;
    }
  }

  async disable(): Promise<SafeTunnelDisableResponse> {
    const workflow = this.cancelActiveEnablement();
    let disableError: unknown;
    let disableFailed = false;
    try {
      await this.dependencies.safeTunnel.disable();
    } catch (error: unknown) {
      disableFailed = true;
      disableError = error;
    }

    await this.dependencies.runtime.stop();
    await workflow?.promise.catch(() => undefined);
    if (disableFailed) throw disableError;
    return { status: await this.status() };
  }

  operation(operationId: string): SafeTunnelOperationResponse | undefined {
    const operation = this.operations.get(operationId);
    return operation === undefined ? undefined : snapshotOperation(operation);
  }

  async shutdown(): Promise<void> {
    const workflow = this.cancelActiveEnablement();
    await this.dependencies.runtime.shutdown();
    await workflow?.promise.catch(() => undefined);
  }

  startup(): Promise<void> {
    return this.dependencies.runtime.startup();
  }

  private async runEnableWorkflow(
    request: SafeTunnelEnableRequest,
    loadedState: LoadedSafeTunnelState,
    currentStatus: SafeTunnelStatusResponse,
    defaults: SafeTunnelEnableDefaults,
    operation: SafeTunnelOperationState,
    signal: AbortSignal,
  ): Promise<SafeTunnelFrpcStartResult> {
    const advanced = request.advanced;
    const localPiWebUrl = advanced?.localPiWebUrl ?? defaults.localPiWebUrl;
    const registrationRequired = shouldRegisterMachine(
      loadedState,
      currentStatus,
      request,
    );

    if (registrationRequired) {
      const controlApiBaseUrl = advanced?.controlApiUrl
        ?? loadedState.state.machine?.controlApiBaseUrl
        ?? defaults.controlApiBaseUrl;
      await this.dependencies.safeTunnel.login({
        controlApiBaseUrl,
        machineName: advanced?.machineName ?? defaults.machineName,
        machineSlug: advanced?.machineSlug ?? defaults.machineSlug,
        localPiWebUrl,
        ...(advanced?.frpcPath === undefined ? {} : { frpcPath: advanced.frpcPath }),
      }, enableLoginObserver(operation), { signal });
      throwIfEnableCancelled(signal);
    }

    operation.phase = "starting";
    appendOperationStdout(
      operation,
      registrationRequired
        ? "Registration complete. Preparing the managed Safe Tunnel runtime.\n"
        : "Using the saved machine registration. Preparing the managed Safe Tunnel runtime.\n",
    );
    await this.dependencies.safeTunnel.enable({
      localPiWebUrl,
      ...(advanced?.frpcPath === undefined ? {} : { frpcPath: advanced.frpcPath }),
    });
    throwIfEnableCancelled(signal);

    const enabledState = await this.dependencies.safeTunnel.state();
    const advancedFrpcPath = enabledState.state.frpcPath;
    return this.dependencies.runtime.start({
      ...(advancedFrpcPath === undefined ? {} : { advancedFrpcPath }),
    });
  }

  private assertNoActiveOperation(): void {
    if (this.operationStartInFlight || this.activeOperation?.status === "running") {
      throw new SafeTunnelBridgeError("A Safe Tunnel operation is already running.", 409);
    }
  }

  private createOperation(): SafeTunnelOperationState {
    const operation: SafeTunnelOperationState = {
      id: randomUUID(),
      kind: "enable",
      phase: "preparing",
      startedAt: this.dependencies.now().toISOString(),
      status: "running",
      stderr: "",
      stdout: "Preparing Safe Tunnel enablement with PI WEB-owned defaults.\n",
      logTailMaxCharacters: maxFrpcLogTailCharacters,
    };
    this.activeOperation = operation;
    this.operations.set(operation.id, operation);
    return operation;
  }

  private cancelActiveEnablement(): ActiveEnableWorkflow | undefined {
    this.enableRequestController?.abort();
    const workflow = this.activeWorkflow;
    if (workflow === undefined) return undefined;
    workflow.controller.abort();
    if (workflow.operation.status === "running") {
      workflow.operation.status = "cancelled";
      workflow.operation.error = enableCancelledMessage;
      workflow.operation.finishedAt = this.dependencies.now().toISOString();
    }
    this.clearActiveOperation(workflow.operation);
    return workflow;
  }

  private failOperation(
    operation: SafeTunnelOperationState,
    error: unknown,
    signal: AbortSignal,
  ): void {
    if (operation.status === "cancelled") return;
    if (signal.aborted) {
      operation.status = "cancelled";
      operation.error = enableCancelledMessage;
    } else {
      operation.status = "failed";
      operation.error = safeErrorMessage(error);
    }
    operation.finishedAt = this.dependencies.now().toISOString();
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

export interface DefaultSafeTunnelBridgeServiceOptions {
  readonly serverAddress: () => SafeTunnelServerAddress;
}

export function createDefaultSafeTunnelBridgeService(
  options: DefaultSafeTunnelBridgeServiceOptions,
): SafeTunnelBridgeService {
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
    enableDefaults: createNodeSafeTunnelEnableDefaultsProvider({
      serverAddress: options.serverAddress,
    }),
    fileExists: existsSync,
    now: () => new Date(),
    runtime,
    safeTunnel,
  });
}

function shouldRegisterMachine(
  loaded: LoadedSafeTunnelState,
  status: SafeTunnelStatusResponse,
  request: SafeTunnelEnableRequest,
): boolean {
  const machine = loaded.state.machine;
  if (machine === undefined || machine.credentialStatus === "rejected") return true;
  if (status.runtime.diagnosticCode === "credentials_rejected") return true;
  const advanced = request.advanced;
  return advanced?.controlApiUrl !== undefined
    || advanced?.machineName !== undefined
    || advanced?.machineSlug !== undefined;
}

function enableLoginObserver(operation: SafeTunnelOperationState): SafeTunnelLoginObserver {
  return {
    onDeviceAuthorization(authorization) {
      operation.phase = "awaiting_approval";
      operation.verificationUriComplete = authorization.verificationUriComplete;
      operation.userCode = authorization.userCode;
      appendOperationStdout(operation, approvalOutput(authorization));
    },
    onAuthorizationApproved(account) {
      operation.phase = "registering";
      appendOperationStdout(
        operation,
        `Approval received for account ${account.publicNamespace}. Registering this PI WEB.\n`,
      );
    },
    onMachineRegistered(machine) {
      operation.phase = "starting";
      operation.publicUrl = machine.publicUrl;
      appendOperationStdout(operation, "Machine registration saved privately.\n");
    },
  };
}

function approvalOutput(authorization: SafeTunnelDeviceAuthorization): string {
  return [
    "Approval is required before this PI WEB can be enabled.",
    `Approval URL: ${authorization.verificationUriComplete}`,
    `User code: ${authorization.userCode}`,
    `Waiting for approval until ${authorization.expiresAt}.`,
    "",
  ].join("\n");
}

function finishEnableOperation(
  operation: SafeTunnelOperationState,
  result: SafeTunnelFrpcStartResult,
  now: Date,
): void {
  if (operation.status === "cancelled") return;
  operation.phase = "enabled";
  operation.publicUrl = result.publicUrl;
  appendOperationStdout(operation, result.output);
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
      : state.machine.credentialStatus === "rejected"
        ? "rejected"
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
    phase: operation.phase,
    startedAt: operation.startedAt,
    status: operation.status,
    stdout: operation.stdout,
    stderr: operation.stderr,
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

function throwIfEnableCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new Error(enableCancelledMessage);
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected Safe Tunnel failure";
}
