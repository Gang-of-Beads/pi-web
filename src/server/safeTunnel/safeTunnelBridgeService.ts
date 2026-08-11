import type {
  SafeTunnelConfigStatus,
  SafeTunnelDisableResponse,
  SafeTunnelEnableRequest,
  SafeTunnelEnableResponse,
  SafeTunnelOperationResponse,
  SafeTunnelRuntimeStatus,
  SafeTunnelStatusResponse,
} from "../../shared/apiTypes.js";
import {
  redactSafeTunnelDiagnostic,
  SafeTunnelCredentialBoundary,
} from "./safeTunnelDiagnostics.js";
import type { SafeTunnelEnableDefaults } from "./safeTunnelEnableDefaults.js";
import {
  SafeTunnelOperationConflictError,
  type SafeTunnelRouteService,
} from "./safeTunnelRoutes.js";
import type { SafeTunnelReconciledFrpcRuntime } from "./safeTunnelRuntimeReconciler.js";
import type {
  SafeTunnelEnableInput,
  SafeTunnelEnableOptions,
  SafeTunnelLoginInput,
  SafeTunnelLoginObserver,
  SafeTunnelLoginOptions,
  SafeTunnelLoginResult,
} from "./safeTunnelService.js";
import type {
  LoadedSafeTunnelState,
  SafeTunnelMachineCredentials,
  SafeTunnelPersistedState,
} from "./safeTunnelState.js";
import type { SafeTunnelFrpcStartResult } from "./safeTunnelFrpcSupervisor.js";

const maxCapturedOutputCharacters = 24_000;
const maxFrpcLogTailCharacters = 12_000;
const maxBrowserDiagnosticCharacters = 2_000;
const maxBrowserIdentifierCharacters = 256;
const maxBrowserPathCharacters = 4_096;
const maxBrowserUrlCharacters = 2_048;
const enableCancelledMessage = "Safe Tunnel enablement was cancelled.";
const enableFailedMessage = "Safe Tunnel enablement failed.";
const invalidStateMessage = "Unable to read PI WEB Safe Tunnel state.";
const fixedBrowserProtocolValues = [
  "enabled",
  "disabled",
  "missing",
  "unregistered",
  "registered",
  "rejected",
  "invalid",
  "stopped",
  "running",
  "unknown",
  "credentials_rejected",
  "heartbeat_retrying",
  "registration_required",
  "runtime_recovery_failed",
  "state_retrying",
  "enable",
  "preparing",
  "awaiting_approval",
  "registering",
  "starting",
  "succeeded",
  "failed",
  "cancelled",
  "true",
  "false",
  "0",
  "accepted",
  "activeOperation",
  "machine",
  "controlApiBaseUrl",
  "machineId",
  "machineSlug",
  "publicHostname",
  "publicUrl",
  "error",
  "statusCode",
  "code",
  "message",
  "400",
  "403",
  "404",
  "409",
  "500",
  "Bad Request",
  "Forbidden",
  "Not Found",
  "Conflict",
  "Internal Server Error",
  "pid",
  "logTail",
  "diagnosticCode",
  "logError",
  "signal",
  "userCode",
  "verificationUriComplete",
  "exitCode",
  "finishedAt",
  "Safe Tunnel runtime started.\n",
  "Approval is required before this PI WEB can be enabled.\n",
  "Approval received. Registering this PI WEB.\n",
  "Machine registration saved privately.\n",
  "Registration complete. Preparing the managed Safe Tunnel runtime.\n",
  "Using the saved machine registration. Preparing the managed Safe Tunnel runtime.\n",
  enableCancelledMessage,
  enableFailedMessage,
  invalidStateMessage,
  "Safe Tunnel request failed.",
  "Safe Tunnel is already enabled.",
  "A Safe Tunnel operation is already running.",
  "Safe Tunnel operation not found",
  "Request forbidden.",
  "Safe Tunnel enable request body must be an object",
  "Safe Tunnel enable request contains an unsupported field",
  "Safe Tunnel advanced overrides must be an object",
  "Safe Tunnel advanced overrides contains an unsupported field",
  "Safe Tunnel advanced controlApiUrl must be a non-empty string",
  "Safe Tunnel advanced controlApiUrl is too long",
  "Safe Tunnel advanced machineName must be a non-empty string",
  "Safe Tunnel advanced machineName is too long",
  "Safe Tunnel advanced machineSlug must be a non-empty string",
  "Safe Tunnel advanced machineSlug is too long",
  "Safe Tunnel advanced localPiWebUrl must be a non-empty string",
  "Safe Tunnel advanced localPiWebUrl is too long",
  "Safe Tunnel advanced frpcPath must be a non-empty string",
  "Safe Tunnel advanced frpcPath is too long",
  "Safe Tunnel disable request body must be an object",
  "Safe Tunnel disable request contains an unsupported field",
] as const;
const fixedBrowserClassificationValues = fixedBrowserProtocolValues.flatMap(
  (value) => [value, JSON.stringify(value)],
);

export interface SafeTunnelBridgeService extends SafeTunnelRouteService {
  shutdown(): Promise<void>;
  startup(): Promise<void>;
}

/** The narrow application-service surface used by the browser adapter. */
export interface SafeTunnelApplicationService {
  readonly statePath: string;
  disable(): Promise<SafeTunnelPersistedState>;
  enable(
    input?: SafeTunnelEnableInput,
    options?: SafeTunnelEnableOptions,
  ): Promise<SafeTunnelPersistedState>;
  login(
    request: SafeTunnelLoginInput,
    observer?: SafeTunnelLoginObserver,
    options?: SafeTunnelLoginOptions,
  ): Promise<SafeTunnelLoginResult>;
  persistCredentialBoundary(boundary: SafeTunnelCredentialBoundary): Promise<void>;
  state(): Promise<LoadedSafeTunnelState>;
}

export interface SafeTunnelBridgeDependencies {
  readonly createOperationId: () => string;
  readonly enableDefaults: () => SafeTunnelEnableDefaults;
  readonly fileExists: (path: string) => boolean;
  readonly now: () => Date;
  readonly runtime: SafeTunnelReconciledFrpcRuntime;
  readonly safeTunnel: SafeTunnelApplicationService;
}

interface SafeTunnelOperationState {
  readonly credentialBoundary: SafeTunnelCredentialBoundary;
  readonly diagnosticSecrets: string[];
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
  logTail?: string;
  publicUrl?: string;
  sealedSnapshot?: SafeTunnelOperationResponse;
  userCode?: string;
  verificationUriComplete?: string;
}

interface ActiveEnableWorkflow {
  readonly controller: AbortController;
  readonly operation: SafeTunnelOperationState;
  readonly promise: Promise<void>;
}

/**
 * Browser-safe orchestration around durable PI WEB state and reconciled frpc
 * supervision. Every effectful collaborator is injected; importing this leaf
 * does not construct or start the production Safe Tunnel graph.
 */
export class DefaultSafeTunnelBridgeService implements SafeTunnelBridgeService {
  private activeOperation: SafeTunnelOperationState | undefined;
  private activeWorkflow: ActiveEnableWorkflow | undefined;
  private enableRequestController: AbortController | undefined;
  private operationStartInFlight = false;
  private readonly operations = new Map<string, SafeTunnelOperationState>();

  constructor(private readonly dependencies: SafeTunnelBridgeDependencies) {}

  async registeredPublicOrigin(): Promise<string | undefined> {
    const loaded = await this.dependencies.safeTunnel.state();
    return loaded.state.machine?.publicUrl;
  }

  async status(): Promise<SafeTunnelStatusResponse> {
    const [runtime, ownedState] = await Promise.all([
      this.dependencies.runtime.status(),
      this.readOwnedStateStatus(),
    ]);
    const operation = this.activeOperation;
    const activeOperation = operation === undefined
      ? undefined
      : snapshotOperation(operation);
    const response = {
      config: ownedState.config,
      desiredState: ownedState.desiredState,
      runtime: snapshotRuntimeStatus(runtime, ownedState.diagnosticSecrets),
      ...(activeOperation === undefined ? {} : { activeOperation }),
    };
    const credentialBoundary = operation?.credentialBoundary
      ?? new SafeTunnelCredentialBoundary();
    requireBrowserPayloadClassification(credentialBoundary, response);
    await this.dependencies.safeTunnel.persistCredentialBoundary(
      credentialBoundary,
    );
    return response;
  }

  async enable(request: SafeTunnelEnableRequest): Promise<SafeTunnelEnableResponse> {
    this.assertNoActiveOperation();
    this.operationStartInFlight = true;
    const controller = new AbortController();
    this.enableRequestController = controller;

    try {
      const [runtime, loadedState] = await Promise.all([
        this.dependencies.runtime.status(),
        this.dependencies.safeTunnel.state(),
      ]);
      throwIfEnableCancelled(controller.signal);
      if (runtime.state === "running") {
        throw new SafeTunnelOperationConflictError("already_enabled");
      }

      const defaults = this.dependencies.enableDefaults();
      throwIfEnableCancelled(controller.signal);
      const initialStatus = statusFromLoadedState(
        this.dependencies.safeTunnel.statePath,
        runtime,
        loadedState,
      );
      const operation = this.createOperation(loadedState, initialStatus);
      try {
        await this.dependencies.safeTunnel.persistCredentialBoundary(
          operation.credentialBoundary,
        );
        throwIfEnableCancelled(controller.signal);
      } catch (error: unknown) {
        this.operations.delete(operation.id);
        this.clearActiveOperation(operation);
        throw error;
      }
      const promise = Promise.resolve()
        .then(() => this.runEnableWorkflow(
          request,
          loadedState,
          runtime,
          defaults,
          operation,
          controller.signal,
        ))
        .then(async (result) => {
          const finishedAt = this.dependencies.now();
          const preview: SafeTunnelOperationState = {
            ...operation,
            diagnosticSecrets: [...operation.diagnosticSecrets],
          };
          finishEnableOperation(preview, result, finishedAt);
          recordBrowserPayload(preview, createOperationSnapshot(preview));
          await this.dependencies.safeTunnel.persistCredentialBoundary(
            preview.credentialBoundary,
          );
          finishEnableOperation(operation, result, finishedAt);
        })
        .catch(async () => {
          this.failOperation(operation, controller.signal);
          try {
            recordBrowserPayload(operation, createOperationSnapshot(operation));
            await this.dependencies.safeTunnel.persistCredentialBoundary(
              operation.credentialBoundary,
            );
          } catch {
            resetOperationToGenericFailure(operation);
            await this.dependencies.safeTunnel.persistCredentialBoundary(
              operation.credentialBoundary,
            ).catch(() => undefined);
          }
        })
        .finally(() => {
          try {
            sealOperation(operation);
          } finally {
            const active = this.activeWorkflow;
            if (active?.operation.id === operation.id) this.activeWorkflow = undefined;
            this.clearActiveOperation(operation);
          }
        });
      this.activeWorkflow = { controller, operation, promise };

      const operationSnapshot = snapshotOperation(operation);
      return {
        accepted: true,
        operation: operationSnapshot,
        status: {
          ...initialStatus,
          activeOperation: snapshotOperation(operation),
        },
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
    let stopError: unknown;
    let stopFailed = false;

    try {
      await this.dependencies.safeTunnel.disable();
    } catch (error: unknown) {
      disableFailed = true;
      disableError = error;
    }

    try {
      await this.dependencies.runtime.stop();
    } catch (error: unknown) {
      stopFailed = true;
      stopError = error;
    }

    await workflow?.promise.catch(() => undefined);
    if (disableFailed) throw disableError;
    if (stopFailed) throw stopError;
    return { status: await this.status() };
  }

  operation(operationId: string): SafeTunnelOperationResponse | undefined {
    const operation = this.operations.get(operationId);
    return operation === undefined ? undefined : snapshotOperation(operation);
  }

  async shutdown(): Promise<void> {
    const workflow = this.cancelActiveEnablement();
    let shutdownError: unknown;
    let shutdownFailed = false;
    try {
      await this.dependencies.runtime.shutdown();
    } catch (error: unknown) {
      shutdownFailed = true;
      shutdownError = error;
    }
    await workflow?.promise.catch(() => undefined);
    if (shutdownFailed) throw shutdownError;
  }

  startup(): Promise<void> {
    return this.dependencies.runtime.startup();
  }

  private async runEnableWorkflow(
    request: SafeTunnelEnableRequest,
    loadedState: LoadedSafeTunnelState,
    runtime: SafeTunnelRuntimeStatus,
    defaults: SafeTunnelEnableDefaults,
    operation: SafeTunnelOperationState,
    signal: AbortSignal,
  ): Promise<SafeTunnelFrpcStartResult> {
    const advanced = request.advanced;
    const localPiWebUrl = advanced?.localPiWebUrl ?? defaults.localPiWebUrl;
    const registrationRequired = shouldRegisterMachine(
      loadedState,
      runtime,
      request,
    );

    if (registrationRequired) {
      const controlApiBaseUrl = advanced?.controlApiUrl
        ?? loadedState.state.machine?.controlApiBaseUrl
        ?? defaults.controlApiBaseUrl;
      const login = await this.dependencies.safeTunnel.login({
        controlApiBaseUrl,
        machineName: advanced?.machineName ?? defaults.machineName,
        machineSlug: advanced?.machineSlug ?? defaults.machineSlug,
        localPiWebUrl,
        ...(advanced?.frpcPath === undefined ? {} : { frpcPath: advanced.frpcPath }),
      }, enableLoginObserver(operation), {
        credentialBoundary: operation.credentialBoundary,
        signal,
      });
      registerOperationDiagnosticSecrets(
        operation,
        login.credentialRedactionValues,
      );
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
    }, { credentialBoundary: operation.credentialBoundary });
    throwIfEnableCancelled(signal);

    const enabledState = await this.dependencies.safeTunnel.state();
    registerOperationDiagnosticSecrets(
      operation,
      diagnosticSecretsFromLoadedState(enabledState),
    );
    throwIfEnableCancelled(signal);
    const advancedFrpcPath = enabledState.state.frpcPath;
    return this.dependencies.runtime.start({
      ...(advancedFrpcPath === undefined ? {} : { advancedFrpcPath }),
    });
  }

  private assertNoActiveOperation(): void {
    if (this.operationStartInFlight || this.activeOperation?.status === "running") {
      throw new SafeTunnelOperationConflictError("operation_in_progress");
    }
  }

  private createOperation(
    loadedState: LoadedSafeTunnelState,
    initialStatus: SafeTunnelStatusResponse,
  ): SafeTunnelOperationState {
    const operationId = this.dependencies.createOperationId();
    if (operationId.trim() === ""
      || operationId.length > maxBrowserIdentifierCharacters
      || this.operations.has(operationId)) {
      throw new Error("Safe Tunnel operation IDs must be non-empty and unique.");
    }
    const credentialBoundary = new SafeTunnelCredentialBoundary();
    const diagnosticSecrets = diagnosticSecretsFromLoadedState(loadedState);
    const startedAt = this.dependencies.now().toISOString();
    const initialOutput = "Preparing Safe Tunnel enablement with PI WEB-owned defaults.\n";
    if (!credentialBoundary.classify({ credentialValues: diagnosticSecrets })) {
      throw new Error("Safe Tunnel credential classification is invalid.");
    }
    const operation: SafeTunnelOperationState = {
      credentialBoundary,
      diagnosticSecrets,
      id: operationId,
      kind: "enable",
      phase: "preparing",
      startedAt,
      status: "running",
      stderr: "",
      stdout: initialOutput,
    };
    if (!credentialBoundary.classify({
      publicValues: [
        ...fixedBrowserClassificationValues,
        ...browserClassificationValues({
          operation: createOperationSnapshot(operation),
          status: initialStatus,
        }),
      ],
    })) {
      throw new Error("Safe Tunnel credential classification is invalid.");
    }
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
      delete workflow.operation.finishedAt;
    }
    this.clearActiveOperation(workflow.operation);
    return workflow;
  }

  private failOperation(
    operation: SafeTunnelOperationState,
    signal: AbortSignal,
  ): void {
    if (operation.status !== "cancelled") {
      if (signal.aborted) {
        operation.status = "cancelled";
        operation.error = enableCancelledMessage;
      } else {
        operation.status = "failed";
        operation.error = enableFailedMessage;
      }
    }
    setOperationFinishedAt(operation, this.dependencies.now());
  }

  private clearActiveOperation(operation: SafeTunnelOperationState): void {
    if (this.activeOperation?.id === operation.id) this.activeOperation = undefined;
  }

  private async readOwnedStateStatus(): Promise<{
    readonly config: SafeTunnelConfigStatus;
    readonly desiredState: SafeTunnelStatusResponse["desiredState"];
    readonly diagnosticSecrets: readonly string[];
  }> {
    try {
      const loaded = await this.dependencies.safeTunnel.state();
      return {
        ...ownedStateStatus(this.dependencies.safeTunnel.statePath, loaded),
        diagnosticSecrets: diagnosticSecretsFromLoadedState(loaded),
      };
    } catch {
      return {
        config: {
          path: headText(
            this.dependencies.safeTunnel.statePath,
            maxBrowserPathCharacters,
          ),
          exists: this.fileExistsSafely(this.dependencies.safeTunnel.statePath),
          state: "invalid",
          error: invalidStateMessage,
        },
        desiredState: "disabled",
        diagnosticSecrets: [],
      };
    }
  }

  private fileExistsSafely(path: string): boolean {
    try {
      return this.dependencies.fileExists(path);
    } catch {
      return false;
    }
  }
}

function shouldRegisterMachine(
  loaded: LoadedSafeTunnelState,
  runtime: SafeTunnelRuntimeStatus,
  request: SafeTunnelEnableRequest,
): boolean {
  const machine = loaded.state.machine;
  if (machine === undefined
    || machine.credentialStatus === "rejected"
    || machine.publicUrl === undefined) return true;
  if (runtime.diagnosticCode === "credentials_rejected") return true;
  const advanced = request.advanced;
  return advanced?.controlApiUrl !== undefined
    || advanced?.machineName !== undefined
    || advanced?.machineSlug !== undefined;
}

function enableLoginObserver(operation: SafeTunnelOperationState): SafeTunnelLoginObserver {
  return {
    onCredentialRedactionValues(values) {
      registerOperationDiagnosticSecrets(operation, values);
    },
    onDeviceAuthorization(authorization) {
      if (operation.status !== "running") return;
      const browserMetadataAccepted = operation.credentialBoundary.classify({
        publicValues: [
          authorization.userCode,
          authorization.verificationUri,
          authorization.verificationUriComplete,
          authorization.expiresAt,
          authorization.intervalSeconds.toString(),
        ],
      });
      operation.phase = "awaiting_approval";
      if (browserMetadataAccepted) {
        operation.verificationUriComplete = authorization.verificationUriComplete;
        operation.userCode = authorization.userCode;
      } else {
        delete operation.verificationUriComplete;
        delete operation.userCode;
      }
      appendOperationStdout(operation, approvalOutput());
    },
    onAuthorizationApproved() {
      if (operation.status !== "running") return;
      operation.phase = "registering";
      delete operation.userCode;
      delete operation.verificationUriComplete;
      appendOperationStdout(
        operation,
        "Approval received. Registering this PI WEB.\n",
      );
    },
    onMachineRegistered() {
      if (operation.status !== "running") return;
      operation.phase = "starting";
      appendOperationStdout(operation, "Machine registration saved privately.\n");
    },
  };
}

function approvalOutput(): string {
  return "Approval is required before this PI WEB can be enabled.\n";
}

function finishEnableOperation(
  operation: SafeTunnelOperationState,
  result: SafeTunnelFrpcStartResult,
  now: Date,
): void {
  if (operation.status === "cancelled") return;
  registerOperationDiagnosticSecrets(
    operation,
    result.credentialRedactionValues,
  );
  operation.phase = "enabled";
  const publicUrl = browserSafeOptionalText(
    result.publicUrl,
    maxBrowserUrlCharacters,
    operation.diagnosticSecrets,
  );
  if (publicUrl === undefined
    || !operation.credentialBoundary.classify({ publicValues: [publicUrl] })) {
    delete operation.publicUrl;
  } else {
    operation.publicUrl = publicUrl;
  }
  const output = redactSafeTunnelDiagnostic(
    result.output,
    operation.diagnosticSecrets,
  );
  if (operation.credentialBoundary.classify({ publicValues: [output] })) {
    appendOperationStdout(operation, output);
    operation.logTail = tailText(output, maxFrpcLogTailCharacters);
  } else {
    appendOperationStdout(operation, "Safe Tunnel runtime started.\n");
    delete operation.logTail;
  }
  operation.status = "succeeded";
  operation.exitCode = 0;
  setOperationFinishedAt(operation, now);
}

function setOperationFinishedAt(
  operation: SafeTunnelOperationState,
  now: Date,
): void {
  const finishedAt = now.toISOString();
  if (operation.credentialBoundary.classify({ publicValues: [finishedAt] })) {
    operation.finishedAt = finishedAt;
  } else {
    delete operation.finishedAt;
  }
}

function statusFromLoadedState(
  statePath: string,
  runtime: SafeTunnelRuntimeStatus,
  loaded: LoadedSafeTunnelState,
): SafeTunnelStatusResponse {
  const ownedState = ownedStateStatus(statePath, loaded);
  return {
    config: ownedState.config,
    desiredState: ownedState.desiredState,
    runtime: snapshotRuntimeStatus(runtime, diagnosticSecretsFromLoadedState(loaded)),
  };
}

function ownedStateStatus(
  statePath: string,
  loaded: LoadedSafeTunnelState,
): {
  readonly config: SafeTunnelConfigStatus;
  readonly desiredState: SafeTunnelStatusResponse["desiredState"];
} {
  const credentialValues = diagnosticSecretsFromLoadedState(loaded);
  return {
    config: configStatusFromOwnedState(statePath, loaded, credentialValues),
    desiredState: loaded.state.desiredState,
  };
}

function configStatusFromOwnedState(
  statePath: string,
  loaded: LoadedSafeTunnelState,
  credentialValues: readonly string[],
): SafeTunnelConfigStatus {
  const state = loaded.state;
  const localPiWebUrl = browserSafeOptionalText(
    state.localPiWebUrl,
    maxBrowserUrlCharacters,
    credentialValues,
  );
  const machine = state.machine === undefined
    ? undefined
    : configMachineStatus(state.machine, credentialValues);
  return {
    path: browserSafeText(statePath, maxBrowserPathCharacters, credentialValues),
    exists: loaded.exists,
    state: state.machine === undefined
      ? (loaded.exists ? "unregistered" : "missing")
      : state.machine.credentialStatus === "rejected"
        ? "rejected"
        : "registered",
    ...(localPiWebUrl === undefined ? {} : { localPiWebUrl }),
    frpcPathConfigured: state.frpcPath !== undefined,
    ...(machine === undefined ? {} : { machine }),
  };
}

function configMachineStatus(
  machine: SafeTunnelMachineCredentials,
  credentialValues: readonly string[],
): SafeTunnelConfigStatus["machine"] | undefined {
  const controlApiBaseUrl = browserSafeOptionalText(
    machine.controlApiBaseUrl,
    maxBrowserUrlCharacters,
    credentialValues,
  );
  const machineId = browserSafeOptionalText(
    machine.machineId,
    maxBrowserIdentifierCharacters,
    credentialValues,
  );
  if (controlApiBaseUrl === undefined || machineId === undefined) return undefined;

  const machineSlug = machine.machineSlug === undefined
    ? undefined
    : browserSafeOptionalText(
      machine.machineSlug,
      maxBrowserIdentifierCharacters,
      credentialValues,
    );
  const publicUrl = machine.publicUrl === undefined
    ? undefined
    : browserSafeOptionalText(
      machine.publicUrl,
      maxBrowserUrlCharacters,
      credentialValues,
    );
  const publicHostname = machine.publicUrl === undefined
    ? undefined
    : browserSafeOptionalText(
      new URL(machine.publicUrl).hostname,
      maxBrowserIdentifierCharacters,
      credentialValues,
    );

  return {
    controlApiBaseUrl,
    machineId,
    ...(machineSlug === undefined ? {} : { machineSlug }),
    ...(publicHostname === undefined ? {} : { publicHostname }),
    ...(publicUrl === undefined ? {} : { publicUrl }),
  };
}

function snapshotRuntimeStatus(
  runtime: SafeTunnelRuntimeStatus,
  diagnosticSecrets: readonly string[],
): SafeTunnelRuntimeStatus {
  const frpcConfigPath = runtime.frpcConfigPath === undefined
    ? undefined
    : browserSafeOptionalText(
      runtime.frpcConfigPath,
      maxBrowserPathCharacters,
      diagnosticSecrets,
    );
  const logPath = runtime.logPath === undefined
    ? undefined
    : browserSafeOptionalText(
      runtime.logPath,
      maxBrowserPathCharacters,
      diagnosticSecrets,
    );
  return {
    state: runtime.state,
    ...(runtime.diagnosticCode === undefined
      ? {}
      : { diagnosticCode: runtime.diagnosticCode }),
    ...(runtime.frpcConfigExists === undefined
      ? {}
      : { frpcConfigExists: runtime.frpcConfigExists }),
    ...(frpcConfigPath === undefined ? {} : { frpcConfigPath }),
    ...(runtime.pid === undefined ? {} : { pid: runtime.pid }),
    ...(runtime.error === undefined
      ? {}
      : {
          error: browserSafeText(
            runtime.error,
            maxBrowserDiagnosticCharacters,
            diagnosticSecrets,
          ),
        }),
    ...(runtime.logError === undefined
      ? {}
      : {
          logError: browserSafeText(
            runtime.logError,
            maxBrowserDiagnosticCharacters,
            diagnosticSecrets,
          ),
        }),
    ...(runtime.logExists === undefined ? {} : { logExists: runtime.logExists }),
    ...(logPath === undefined ? {} : { logPath }),
    ...(runtime.logTail === undefined
      ? {}
      : {
          logTail: browserSafeTailText(
            runtime.logTail,
            maxFrpcLogTailCharacters,
            diagnosticSecrets,
          ),
        }),
    logTailMaxCharacters: maxFrpcLogTailCharacters,
  };
}

function snapshotOperation(operation: SafeTunnelOperationState): SafeTunnelOperationResponse {
  if (operation.sealedSnapshot !== undefined) return { ...operation.sealedSnapshot };
  const snapshot = createOperationSnapshot(operation);
  recordBrowserPayload(operation, snapshot);
  return snapshot;
}

function createOperationSnapshot(
  operation: SafeTunnelOperationState,
): SafeTunnelOperationResponse {
  const credentialValues = operation.diagnosticSecrets;
  const finishedAt = operation.finishedAt === undefined
    ? undefined
    : browserSafeOptionalText(
      operation.finishedAt,
      maxBrowserIdentifierCharacters,
      credentialValues,
    );
  const publicUrl = operation.publicUrl === undefined
    ? undefined
    : browserSafeOptionalText(
      operation.publicUrl,
      maxBrowserUrlCharacters,
      credentialValues,
    );
  const userCode = operation.userCode === undefined
    ? undefined
    : browserSafeOptionalText(
      operation.userCode,
      maxBrowserIdentifierCharacters,
      credentialValues,
    );
  const verificationUriComplete = operation.verificationUriComplete === undefined
    ? undefined
    : browserSafeOptionalText(
      operation.verificationUriComplete,
      maxBrowserUrlCharacters,
      credentialValues,
    );

  return {
    id: browserSafeText(operation.id, maxBrowserIdentifierCharacters, credentialValues),
    kind: operation.kind,
    phase: operation.phase,
    startedAt: browserSafeText(
      operation.startedAt,
      maxBrowserIdentifierCharacters,
      credentialValues,
    ),
    status: operation.status,
    stdout: browserSafeTailText(
      operation.stdout,
      maxCapturedOutputCharacters,
      credentialValues,
    ),
    stderr: browserSafeTailText(
      operation.stderr,
      maxCapturedOutputCharacters,
      credentialValues,
    ),
    ...(operation.error === undefined
      ? {}
      : {
          error: browserSafeText(
            operation.error,
            maxBrowserDiagnosticCharacters,
            credentialValues,
          ),
        }),
    ...(operation.exitCode === undefined ? {} : { exitCode: operation.exitCode }),
    ...(finishedAt === undefined ? {} : { finishedAt }),
    ...(operation.logTail === undefined || operation.logTail === ""
      ? {}
      : {
          logTail: browserSafeTailText(
            operation.logTail,
            maxFrpcLogTailCharacters,
            credentialValues,
          ),
        }),
    logTailMaxCharacters: maxFrpcLogTailCharacters,
    ...(publicUrl === undefined ? {} : { publicUrl }),
    ...(userCode === undefined ? {} : { userCode }),
    ...(verificationUriComplete === undefined ? {} : { verificationUriComplete }),
  };
}

function recordBrowserPayload(
  operation: SafeTunnelOperationState,
  payload: unknown,
): void {
  requireBrowserPayloadClassification(operation.credentialBoundary, payload);
}

function requireBrowserPayloadClassification(
  boundary: SafeTunnelCredentialBoundary,
  payload: unknown,
): void {
  if (!boundary.classify({
    publicValues: browserClassificationValues(payload),
  })) {
    throw new Error("Safe Tunnel credential crossed the browser boundary.");
  }
}

function browserClassificationValues(payload: unknown): readonly string[] {
  const values = new Set<string>();
  const scalarValues: string[] = [];
  const visited = new WeakSet();
  const addString = (value: string, scalar: boolean): void => {
    values.add(value);
    values.add(JSON.stringify(value));
    if (scalar) scalarValues.push(value);
  };
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      addString(value, true);
      return;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      addString(value.toString(), true);
      return;
    }
    if (value === null) {
      addString("null", true);
      return;
    }
    if (typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      addString(key, false);
      visit(item);
    }
  };
  visit(payload);
  if (scalarValues.length > 1) values.add(scalarValues.join(""));
  const serialized: unknown = JSON.stringify(payload);
  if (typeof serialized === "string") values.add(serialized);
  return [...values];
}

function diagnosticSecretsFromLoadedState(
  loaded: LoadedSafeTunnelState,
): string[] {
  const machineToken = loaded.state.machine?.machineToken;
  return [
    ...(loaded.state.credentialBoundaryPrivateValues ?? []),
    ...(machineToken === undefined ? [] : [machineToken]),
  ];
}

function registerOperationDiagnosticSecrets(
  operation: SafeTunnelOperationState,
  values: readonly string[],
): void {
  if (!operation.credentialBoundary.classify({ credentialValues: values })) {
    throw new Error("Safe Tunnel credential crossed the browser boundary.");
  }
  for (const value of values) {
    if (value !== "" && !operation.diagnosticSecrets.includes(value)) {
      operation.diagnosticSecrets.push(value);
    }
  }
  redactOperationDiagnostics(operation);
}

function resetOperationToGenericFailure(operation: SafeTunnelOperationState): void {
  operation.stdout = "";
  operation.stderr = "";
  operation.error = operation.status === "cancelled"
    ? enableCancelledMessage
    : enableFailedMessage;
  delete operation.exitCode;
  delete operation.finishedAt;
  delete operation.logTail;
  delete operation.publicUrl;
  delete operation.userCode;
  delete operation.verificationUriComplete;
  operation.credentialBoundary.clear();
  if (!operation.credentialBoundary.classify({
    credentialValues: operation.diagnosticSecrets,
    publicValues: [
      ...fixedBrowserClassificationValues,
      ...browserClassificationValues(createOperationSnapshot(operation)),
    ],
  })) {
    throw new Error("Safe Tunnel credential classification is invalid.");
  }
}

function sealOperation(operation: SafeTunnelOperationState): void {
  redactOperationDiagnostics(operation);
  const snapshot = createOperationSnapshot(operation);
  recordBrowserPayload(operation, snapshot);
  operation.sealedSnapshot = snapshot;
  delete operation.publicUrl;
  delete operation.userCode;
  delete operation.verificationUriComplete;
  operation.diagnosticSecrets.length = 0;
  operation.credentialBoundary.clear();
}

function redactOperationDiagnostics(operation: SafeTunnelOperationState): void {
  operation.stdout = redactSafeTunnelDiagnostic(
    operation.stdout,
    operation.diagnosticSecrets,
  );
  operation.stderr = redactSafeTunnelDiagnostic(
    operation.stderr,
    operation.diagnosticSecrets,
  );
  if (operation.error !== undefined) {
    operation.error = redactSafeTunnelDiagnostic(
      operation.error,
      operation.diagnosticSecrets,
    );
  }
  if (operation.logTail !== undefined) {
    operation.logTail = redactSafeTunnelDiagnostic(
      operation.logTail,
      operation.diagnosticSecrets,
    );
  }
}

function appendOperationStdout(operation: SafeTunnelOperationState, chunk: string): void {
  operation.stdout = appendCapped(
    operation.stdout,
    redactSafeTunnelDiagnostic(chunk, operation.diagnosticSecrets),
    maxCapturedOutputCharacters,
  );
}

function appendCapped(existing: string, chunk: string, maxCharacters: number): string {
  const next = `${existing}${chunk}`;
  return next.length <= maxCharacters
    ? next
    : next.slice(next.length - maxCharacters);
}

function browserSafeOptionalText(
  contents: string,
  maxCharacters: number,
  credentialValues: readonly string[],
): string | undefined {
  const redacted = redactSafeTunnelDiagnostic(contents, credentialValues);
  return redacted === contents ? headText(redacted, maxCharacters) : undefined;
}

function browserSafeText(
  contents: string,
  maxCharacters: number,
  credentialValues: readonly string[],
): string {
  return headText(
    redactSafeTunnelDiagnostic(contents, credentialValues),
    maxCharacters,
  );
}

function browserSafeTailText(
  contents: string,
  maxCharacters: number,
  credentialValues: readonly string[],
): string {
  return tailText(
    redactSafeTunnelDiagnostic(contents, credentialValues),
    maxCharacters,
  );
}

function headText(contents: string, maxCharacters: number): string {
  return contents.length <= maxCharacters ? contents : contents.slice(0, maxCharacters);
}

function tailText(contents: string, maxCharacters: number): string {
  return contents.length <= maxCharacters
    ? contents
    : contents.slice(contents.length - maxCharacters);
}

function throwIfEnableCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new Error(enableCancelledMessage);
}
