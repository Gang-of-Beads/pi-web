import type {
  SafeTunnelCommandOutput,
  SafeTunnelRuntimeStatus,
} from "../../shared/apiTypes.js";
import {
  SafeTunnelControlPlaneError,
  type SafeTunnelHeartbeatTunnelStatus,
  type SafeTunnelMachineHeartbeat,
} from "./safeTunnelControlPlane.js";
import {
  SafeTunnelFrpcSupervisorError,
  type SafeTunnelFrpcRuntime,
  type SafeTunnelFrpcStartInput,
  type SafeTunnelFrpcStartResult,
  type SafeTunnelScheduledTask,
  type SafeTunnelSupervisorClock,
} from "./safeTunnelFrpcSupervisor.js";
import { SafeTunnelServiceError } from "./safeTunnelService.js";
import type { LoadedSafeTunnelState } from "./safeTunnelState.js";

const defaultInitialRecoveryDelayMs = 1_000;
const defaultMaximumRecoveryDelayMs = 30_000;
const defaultMinimumHeartbeatIntervalMs = 5_000;
const defaultMaximumHeartbeatIntervalMs = 300_000;
const runtimeRecoveringMessage = "PI WEB Safe Tunnel runtime is recovering.";
const registrationRequiredMessage = "Safe Tunnel is enabled but its machine registration is missing. Enable Safe Tunnel to approve this PI WEB.";
const credentialsRejectedMessage = "Safe Tunnel access for this PI WEB was rejected or revoked. Enable Safe Tunnel to approve it again.";
const childStopUnconfirmedMessage = "PI WEB could not confirm that its owned frpc process stopped.";

export interface SafeTunnelRuntimeReconciliationService {
  recordHeartbeat(
    input: {
      readonly tunnelStatus: SafeTunnelHeartbeatTunnelStatus;
      readonly errorMessage?: string;
    },
    options?: { readonly signal?: AbortSignal },
  ): Promise<SafeTunnelMachineHeartbeat>;
  state(): Promise<LoadedSafeTunnelState>;
}

export interface SafeTunnelReconciledFrpcRuntime extends SafeTunnelFrpcRuntime {
  reconcile(): Promise<void>;
  startup(): Promise<void>;
}

export interface SafeTunnelRuntimeReconcilerPolicy {
  readonly initialRecoveryDelayMs?: number;
  readonly maximumHeartbeatIntervalMs?: number;
  readonly maximumRecoveryDelayMs?: number;
  readonly minimumHeartbeatIntervalMs?: number;
}

export interface SafeTunnelRuntimeReconcilerDependencies {
  readonly clock: SafeTunnelSupervisorClock;
  readonly runtime: SafeTunnelFrpcRuntime;
  readonly safeTunnel: SafeTunnelRuntimeReconciliationService;
  readonly policy?: SafeTunnelRuntimeReconcilerPolicy;
}

interface NormalizedSafeTunnelRuntimeReconcilerPolicy {
  readonly initialRecoveryDelayMs: number;
  readonly maximumHeartbeatIntervalMs: number;
  readonly maximumRecoveryDelayMs: number;
  readonly minimumHeartbeatIntervalMs: number;
}

interface SafeTunnelLifecycleDiagnostic {
  readonly code: NonNullable<SafeTunnelRuntimeStatus["diagnosticCode"]>;
  readonly message: string;
}

interface SafeTunnelSafetyStop {
  failures: number;
  readonly confirmedDiagnostic?: SafeTunnelLifecycleDiagnostic;
  readonly failureDiagnostic: SafeTunnelLifecycleDiagnostic;
}

type SafeTunnelSafetyStopAttempt =
  | {
    readonly kind: "confirmed";
    readonly contextCurrent: boolean;
    readonly output: SafeTunnelCommandOutput;
  }
  | { readonly kind: "failed"; readonly error: unknown };

/**
 * Reconciles durable enabled intent into the direct frpc supervisor and owns
 * heartbeat/recovery work around it. The child supervisor remains the sole
 * owner of process handles and process restart policy.
 */
export class SafeTunnelRuntimeReconciler implements SafeTunnelReconciledFrpcRuntime {
  private disposed = false;
  private generation = 0;
  private heartbeatAbortController: AbortController | undefined;
  private heartbeatFailures = 0;
  private heartbeatInFlight: Promise<void> | undefined;
  private heartbeatTask: SafeTunnelScheduledTask | undefined;
  private heartbeatAuthenticationRejected = false;
  private lifecycleDiagnosticCode: SafeTunnelRuntimeStatus["diagnosticCode"];
  private lifecycleError: string | undefined;
  private pendingSafetyStop: SafeTunnelSafetyStop | undefined;
  private readonly policy: NormalizedSafeTunnelRuntimeReconcilerPolicy;
  private reconciliationFailures = 0;
  private reconciliationTask: SafeTunnelScheduledTask | undefined;
  private shutdownInFlight: Promise<void> | undefined;
  private started = false;
  private startupInFlight: Promise<void> | undefined;
  private stopInFlight: Promise<SafeTunnelCommandOutput> | undefined;
  private stopRecoveryTask: SafeTunnelScheduledTask | undefined;
  private supervisionActive = false;

  constructor(private readonly dependencies: SafeTunnelRuntimeReconcilerDependencies) {
    this.policy = normalizePolicy(dependencies.policy);
  }

  startup(): Promise<void> {
    if (this.disposed || this.started) return Promise.resolve();
    if (this.startupInFlight !== undefined) return this.startupInFlight;

    this.started = true;
    const startup = this.reconcile();
    this.startupInFlight = startup;
    void startup.then(
      () => { if (this.startupInFlight === startup) this.startupInFlight = undefined; },
      () => { if (this.startupInFlight === startup) this.startupInFlight = undefined; },
    );
    return startup;
  }

  async reconcile(): Promise<void> {
    if (this.disposed) return;
    const generation = this.beginGeneration();
    await this.waitForHeartbeat();
    if (!this.isCurrent(generation)) return;

    const pendingSafetyStop = this.pendingSafetyStop;
    if (pendingSafetyStop !== undefined) {
      const stopAttempt = await this.attemptSafetyStop(
        generation,
        pendingSafetyStop,
        () => { this.reconcileDetached(); },
      );
      if (!this.isCurrent(generation) || stopAttempt.kind === "failed") return;
    }

    let loaded: LoadedSafeTunnelState;
    try {
      loaded = await this.dependencies.safeTunnel.state();
    } catch {
      this.scheduleReconciliationRecovery(generation);
      return;
    }
    if (!this.isCurrent(generation)) return;

    this.reconciliationFailures = 0;
    if (loaded.state.desiredState === "disabled") {
      this.clearLifecycleDiagnostic();
      await this.stopForSafety(generation, {
        failures: 0,
        failureDiagnostic: {
          code: "runtime_recovery_failed",
          message: `Safe Tunnel is disabled. ${childStopUnconfirmedMessage}`,
        },
      });
      return;
    }

    if (loaded.state.machine === undefined) {
      const diagnostic = {
        code: "registration_required",
        message: registrationRequiredMessage,
      } as const;
      this.applyLifecycleDiagnostic(diagnostic);
      await this.stopForSafety(generation, {
        failures: 0,
        confirmedDiagnostic: diagnostic,
        failureDiagnostic: {
          ...diagnostic,
          message: `${diagnostic.message} ${childStopUnconfirmedMessage}`,
        },
      });
      return;
    }

    if (loaded.state.machine.credentialStatus === "rejected"
      || this.heartbeatAuthenticationRejected) {
      const diagnostic = {
        code: "credentials_rejected",
        message: credentialsRejectedMessage,
      } as const;
      this.applyLifecycleDiagnostic(diagnostic);
      await this.stopForSafety(generation, {
        failures: 0,
        confirmedDiagnostic: diagnostic,
        failureDiagnostic: {
          ...diagnostic,
          message: `${diagnostic.message} ${childStopUnconfirmedMessage}`,
        },
      });
      return;
    }

    const input: SafeTunnelFrpcStartInput = {
      ...(loaded.state.frpcPath === undefined
        ? {}
        : { advancedFrpcPath: loaded.state.frpcPath }),
    };
    if (this.supervisionActive) {
      const stopAttempt = await this.stopForSafety(
        generation,
        {
          failures: 0,
          failureDiagnostic: {
            code: "runtime_recovery_failed",
            message: "PI WEB could not safely restart Safe Tunnel supervision after registration changed.",
          },
        },
        () => { this.armSupervision(input, generation); },
      );
      if (stopAttempt.kind === "confirmed" && this.isCurrent(generation)) {
        this.armSupervision(input, generation);
      }
      return;
    }

    await this.waitForChildStop();
    if (!this.isCurrent(generation)) return;
    this.armSupervision(input, generation);
  }

  async start(input: SafeTunnelFrpcStartInput): Promise<SafeTunnelFrpcStartResult> {
    if (this.disposed) throw new SafeTunnelFrpcSupervisorError("supervisor_shutdown");
    const generation = this.beginGeneration();
    await this.waitForHeartbeat();

    const pendingSafetyStop = this.pendingSafetyStop;
    if (pendingSafetyStop !== undefined) {
      const stopAttempt = await this.attemptSafetyStop(
        generation,
        pendingSafetyStop,
      );
      if (stopAttempt.kind === "failed") throw stopAttempt.error;
    }
    await this.waitForChildStop();
    if (!this.isCurrent(generation)) {
      throw new SafeTunnelFrpcSupervisorError("start_cancelled");
    }

    this.clearLifecycleDiagnostic();
    this.heartbeatAuthenticationRejected = false;
    this.heartbeatFailures = 0;
    this.reconciliationFailures = 0;
    this.supervisionActive = true;
    const starting = this.dependencies.runtime.start(input);
    this.scheduleHeartbeat(generation, 0);
    return starting;
  }

  async stop(): Promise<SafeTunnelCommandOutput> {
    const generation = this.beginGeneration();
    await this.waitForHeartbeat();
    this.clearLifecycleDiagnostic();
    this.heartbeatFailures = 0;
    this.reconciliationFailures = 0;
    const stopAttempt = await this.stopForSafety(generation, {
      failures: 0,
      failureDiagnostic: {
        code: "runtime_recovery_failed",
        message: `Safe Tunnel is disabled. ${childStopUnconfirmedMessage}`,
      },
    });
    if (stopAttempt.kind === "failed") throw stopAttempt.error;
    return stopAttempt.output;
  }

  shutdown(): Promise<void> {
    if (this.shutdownInFlight !== undefined) return this.shutdownInFlight;

    this.disposed = true;
    this.beginGeneration();
    const shutdown = this.performShutdown();
    this.shutdownInFlight = shutdown;
    void shutdown.then(
      () => undefined,
      () => {
        // The child supervisor retains an unconfirmed exact handle. Let a
        // later shutdown attempt reach it again instead of memoizing failure.
        if (this.shutdownInFlight === shutdown) this.shutdownInFlight = undefined;
      },
    );
    return shutdown;
  }

  async status(): Promise<SafeTunnelRuntimeStatus> {
    const status = await this.dependencies.runtime.status();
    if (this.lifecycleError === undefined) return status;
    return {
      ...status,
      ...(this.lifecycleDiagnosticCode === undefined
        ? {}
        : { diagnosticCode: this.lifecycleDiagnosticCode }),
      error: joinErrors(this.lifecycleError, status.error),
    };
  }

  private async performShutdown(): Promise<void> {
    await this.waitForHeartbeat();
    await this.stopInFlight?.catch(() => undefined);
    this.supervisionActive = false;
    await this.dependencies.runtime.shutdown();
    this.pendingSafetyStop = undefined;
    this.cancelStopRecoveryTask();
  }

  private armSupervision(input: SafeTunnelFrpcStartInput, generation: number): void {
    this.clearLifecycleDiagnostic();
    this.heartbeatFailures = 0;
    this.supervisionActive = true;
    const starting = this.dependencies.runtime.start(input);
    this.scheduleHeartbeat(generation, 0);
    void starting.catch(() => undefined);
  }

  private scheduleHeartbeat(generation: number, delayMs: number): void {
    if (!this.isHeartbeatCurrent(generation)) return;
    this.cancelHeartbeatTask();
    this.heartbeatTask = this.dependencies.clock.schedule(() => {
      this.heartbeatTask = undefined;
      if (!this.isHeartbeatCurrent(generation)) return;
      this.beginHeartbeat(generation);
    }, delayMs);
  }

  private beginHeartbeat(generation: number): void {
    const controller = new AbortController();
    this.heartbeatAbortController = controller;
    const heartbeat = this.sendHeartbeat(controller.signal).then(
      (result) => { this.handleHeartbeatSuccess(generation, result); },
      (error: unknown) => this.handleHeartbeatFailure(generation, error),
    );
    this.heartbeatInFlight = heartbeat;
    void heartbeat.then(
      () => { this.clearHeartbeatInFlight(heartbeat, controller); },
      () => { this.clearHeartbeatInFlight(heartbeat, controller); },
    );
  }

  private async sendHeartbeat(signal: AbortSignal): Promise<SafeTunnelMachineHeartbeat> {
    const runtime = await abortable(this.dependencies.runtime.status(), signal);
    return abortable(
      this.dependencies.safeTunnel.recordHeartbeat(heartbeatInput(runtime), { signal }),
      signal,
    );
  }

  private handleHeartbeatSuccess(
    generation: number,
    heartbeat: SafeTunnelMachineHeartbeat,
  ): void {
    if (!this.isHeartbeatCurrent(generation)) return;
    this.heartbeatFailures = 0;
    this.clearLifecycleDiagnostic();
    this.scheduleHeartbeat(
      generation,
      normalizeHeartbeatInterval(heartbeat.nextHeartbeatSeconds, this.policy),
    );
  }

  private async handleHeartbeatFailure(
    generation: number,
    error: unknown,
  ): Promise<void> {
    if (!this.isHeartbeatCurrent(generation)) return;

    if (isAuthenticationFailure(error)) {
      this.cancelHeartbeatTask();
      this.cancelReconciliationTask();
      this.heartbeatAuthenticationRejected = true;
      const diagnostic = {
        code: "credentials_rejected",
        message: credentialsRejectedMessage,
      } as const;
      this.applyLifecycleDiagnostic(diagnostic);
      await this.stopForSafety(generation, {
        failures: 0,
        confirmedDiagnostic: diagnostic,
        failureDiagnostic: {
          ...diagnostic,
          message: `${diagnostic.message} ${childStopUnconfirmedMessage}`,
        },
      });
      return;
    }

    this.heartbeatFailures += 1;
    const delayMs = recoveryDelay(this.heartbeatFailures, this.policy);
    this.setLifecycleDiagnostic(
      "heartbeat_retrying",
      `Safe Tunnel heartbeat failed. Retrying in ${formatDelay(delayMs)}.`,
    );
    this.scheduleHeartbeat(generation, delayMs);
  }

  private scheduleReconciliationRecovery(generation: number): void {
    if (!this.isCurrent(generation)) return;
    this.reconciliationFailures += 1;
    const delayMs = recoveryDelay(this.reconciliationFailures, this.policy);
    this.setLifecycleDiagnostic(
      "state_retrying",
      `PI WEB could not reconcile persisted Safe Tunnel intent. Retrying in ${formatDelay(delayMs)}.`,
    );
    this.cancelReconciliationTask();
    this.reconciliationTask = this.dependencies.clock.schedule(() => {
      this.reconciliationTask = undefined;
      if (!this.isCurrent(generation)) return;
      this.reconcileDetached();
    }, delayMs);
  }

  private reconcileDetached(): void {
    const reconciliation = this.reconcile();
    void reconciliation.catch(() => undefined);
  }

  private stopForSafety(
    generation: number,
    context: SafeTunnelSafetyStop,
    onRecoveryConfirmed?: () => void,
  ): Promise<SafeTunnelSafetyStopAttempt> {
    this.supervisionActive = false;
    this.pendingSafetyStop = context;
    this.cancelStopRecoveryTask();
    return this.attemptSafetyStop(generation, context, onRecoveryConfirmed);
  }

  private async attemptSafetyStop(
    generation: number,
    context: SafeTunnelSafetyStop,
    onRecoveryConfirmed?: () => void,
  ): Promise<SafeTunnelSafetyStopAttempt> {
    let output: SafeTunnelCommandOutput;
    try {
      output = await this.stopChild();
    } catch (error: unknown) {
      if (this.isCurrent(generation) && this.pendingSafetyStop === context) {
        context.failures += 1;
        const delayMs = recoveryDelay(context.failures, this.policy);
        this.setLifecycleDiagnostic(
          context.failureDiagnostic.code,
          `${context.failureDiagnostic.message} Retrying in ${formatDelay(delayMs)}.`,
        );
        this.scheduleStopRecovery(
          generation,
          context,
          delayMs,
          onRecoveryConfirmed,
        );
      }
      return { kind: "failed", error };
    }

    const contextCurrent = this.pendingSafetyStop === context;
    if (contextCurrent) {
      this.pendingSafetyStop = undefined;
      this.cancelStopRecoveryTask();
      if (this.isCurrent(generation)) {
        this.applyLifecycleDiagnostic(context.confirmedDiagnostic);
      }
    }
    return { kind: "confirmed", contextCurrent, output };
  }

  private scheduleStopRecovery(
    generation: number,
    context: SafeTunnelSafetyStop,
    delayMs: number,
    onRecoveryConfirmed?: () => void,
  ): void {
    this.cancelStopRecoveryTask();
    this.stopRecoveryTask = this.dependencies.clock.schedule(() => {
      this.stopRecoveryTask = undefined;
      if (!this.isCurrent(generation) || this.pendingSafetyStop !== context) return;
      const recovery = this.attemptSafetyStop(
        generation,
        context,
        onRecoveryConfirmed,
      );
      void recovery.then((attempt) => {
        if (attempt.kind !== "confirmed"
          || !attempt.contextCurrent
          || !this.isCurrent(generation)) return;
        onRecoveryConfirmed?.();
      }).catch(() => undefined);
    }, delayMs);
  }

  private applyLifecycleDiagnostic(
    diagnostic: SafeTunnelLifecycleDiagnostic | undefined,
  ): void {
    if (diagnostic === undefined) {
      this.clearLifecycleDiagnostic();
      return;
    }
    this.setLifecycleDiagnostic(diagnostic.code, diagnostic.message);
  }

  private clearLifecycleDiagnostic(): void {
    this.lifecycleDiagnosticCode = undefined;
    this.lifecycleError = undefined;
  }

  private setLifecycleDiagnostic(
    code: NonNullable<SafeTunnelRuntimeStatus["diagnosticCode"]>,
    message: string,
  ): void {
    this.lifecycleDiagnosticCode = code;
    this.lifecycleError = message;
  }

  private stopChild(): Promise<SafeTunnelCommandOutput> {
    if (this.stopInFlight !== undefined) return this.stopInFlight;
    const stopping = Promise.resolve().then(() => this.dependencies.runtime.stop());
    this.stopInFlight = stopping;
    void stopping.then(
      () => { if (this.stopInFlight === stopping) this.stopInFlight = undefined; },
      () => { if (this.stopInFlight === stopping) this.stopInFlight = undefined; },
    );
    return stopping;
  }

  private async waitForChildStop(): Promise<void> {
    await this.stopInFlight;
  }

  private async waitForHeartbeat(): Promise<void> {
    await this.heartbeatInFlight?.catch(() => undefined);
  }

  private beginGeneration(): number {
    this.generation += 1;
    this.cancelHeartbeatTask();
    this.cancelReconciliationTask();
    this.cancelStopRecoveryTask();
    this.heartbeatAbortController?.abort();
    this.heartbeatAbortController = undefined;
    return this.generation;
  }

  private clearHeartbeatInFlight(
    heartbeat: Promise<void>,
    controller: AbortController,
  ): void {
    if (this.heartbeatInFlight === heartbeat) this.heartbeatInFlight = undefined;
    if (this.heartbeatAbortController === controller) {
      this.heartbeatAbortController = undefined;
    }
  }

  private cancelHeartbeatTask(): void {
    this.heartbeatTask?.cancel();
    this.heartbeatTask = undefined;
  }

  private cancelReconciliationTask(): void {
    this.reconciliationTask?.cancel();
    this.reconciliationTask = undefined;
  }

  private cancelStopRecoveryTask(): void {
    this.stopRecoveryTask?.cancel();
    this.stopRecoveryTask = undefined;
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && this.generation === generation;
  }

  private isHeartbeatCurrent(generation: number): boolean {
    return this.isCurrent(generation) && this.supervisionActive;
  }
}

function heartbeatInput(runtime: SafeTunnelRuntimeStatus): {
  readonly tunnelStatus: SafeTunnelHeartbeatTunnelStatus;
  readonly errorMessage?: string;
} {
  switch (runtime.state) {
    case "running":
      return { tunnelStatus: "running" };
    case "unknown":
      return runtime.error === undefined
        ? { tunnelStatus: "starting" }
        : { tunnelStatus: "error", errorMessage: runtimeRecoveringMessage };
    case "stopped":
      return { tunnelStatus: "error", errorMessage: runtimeRecoveringMessage };
  }
}

function normalizePolicy(
  policy: SafeTunnelRuntimeReconcilerPolicy = {},
): NormalizedSafeTunnelRuntimeReconcilerPolicy {
  const normalized = {
    initialRecoveryDelayMs: positiveInteger(
      policy.initialRecoveryDelayMs ?? defaultInitialRecoveryDelayMs,
      "initialRecoveryDelayMs",
    ),
    maximumHeartbeatIntervalMs: positiveInteger(
      policy.maximumHeartbeatIntervalMs ?? defaultMaximumHeartbeatIntervalMs,
      "maximumHeartbeatIntervalMs",
    ),
    maximumRecoveryDelayMs: positiveInteger(
      policy.maximumRecoveryDelayMs ?? defaultMaximumRecoveryDelayMs,
      "maximumRecoveryDelayMs",
    ),
    minimumHeartbeatIntervalMs: positiveInteger(
      policy.minimumHeartbeatIntervalMs ?? defaultMinimumHeartbeatIntervalMs,
      "minimumHeartbeatIntervalMs",
    ),
  };
  if (normalized.maximumRecoveryDelayMs < normalized.initialRecoveryDelayMs) {
    throw new Error("maximumRecoveryDelayMs must not be shorter than initialRecoveryDelayMs.");
  }
  if (normalized.maximumHeartbeatIntervalMs < normalized.minimumHeartbeatIntervalMs) {
    throw new Error("maximumHeartbeatIntervalMs must not be shorter than minimumHeartbeatIntervalMs.");
  }
  return normalized;
}

function normalizeHeartbeatInterval(
  seconds: number,
  policy: NormalizedSafeTunnelRuntimeReconcilerPolicy,
): number {
  const maximumSeconds = Math.floor(policy.maximumHeartbeatIntervalMs / 1_000);
  const boundedSeconds = Math.min(seconds, Math.max(1, maximumSeconds));
  return Math.min(
    policy.maximumHeartbeatIntervalMs,
    Math.max(policy.minimumHeartbeatIntervalMs, boundedSeconds * 1_000),
  );
}

function recoveryDelay(
  failureCount: number,
  policy: NormalizedSafeTunnelRuntimeReconcilerPolicy,
): number {
  const exponent = Math.min(failureCount - 1, 30);
  return Math.min(
    policy.maximumRecoveryDelayMs,
    policy.initialRecoveryDelayMs * (2 ** exponent),
  );
}

function isAuthenticationFailure(error: unknown): boolean {
  if (error instanceof SafeTunnelControlPlaneError) {
    return error.code === "authentication_failed";
  }
  return error instanceof SafeTunnelServiceError
    && error.code === "credentials_rejected";
}

function joinErrors(primary: string, secondary: string | undefined): string {
  if (secondary === undefined || secondary === primary) return primary;
  return `${primary} ${secondary}`;
}

function formatDelay(milliseconds: number): string {
  if (milliseconds % 1_000 !== 0) return `${milliseconds.toString()} ms`;
  const seconds = milliseconds / 1_000;
  return `${seconds.toString()} ${seconds === 1 ? "second" : "seconds"}`;
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("Safe Tunnel operation cancelled."));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      complete();
    };
    const onAbort = (): void => {
      finish(() => { reject(new Error("Safe Tunnel operation cancelled.")); });
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void operation.then(
      (value) => { finish(() => { resolve(value); }); },
      (error: unknown) => {
        finish(() => {
          reject(error instanceof Error ? error : new Error("Unexpected Safe Tunnel failure."));
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
