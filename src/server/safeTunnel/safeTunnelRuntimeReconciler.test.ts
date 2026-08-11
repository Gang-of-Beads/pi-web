import { describe, expect, it } from "vitest";
import type {
  SafeTunnelCommandOutput,
  SafeTunnelRuntimeStatus,
} from "../../shared/apiTypes.js";
import {
  SafeTunnelControlPlaneError,
  type SafeTunnelHeartbeatTunnelStatus,
  type SafeTunnelMachineHeartbeat,
} from "./safeTunnelControlPlane.js";
import type {
  SafeTunnelFrpcRuntime,
  SafeTunnelFrpcStartInput,
  SafeTunnelFrpcStartResult,
  SafeTunnelScheduledTask,
  SafeTunnelSupervisorClock,
} from "./safeTunnelFrpcSupervisor.js";
import {
  SafeTunnelRuntimeReconciler,
  type SafeTunnelRuntimeReconciliationService,
} from "./safeTunnelRuntimeReconciler.js";
import { SafeTunnelServiceError } from "./safeTunnelService.js";
import {
  createDefaultSafeTunnelState,
  type LoadedSafeTunnelState,
} from "./safeTunnelState.js";

const policy = {
  initialRecoveryDelayMs: 10,
  maximumHeartbeatIntervalMs: 100_000,
  maximumRecoveryDelayMs: 40,
  minimumHeartbeatIntervalMs: 20_000,
} as const;
const credentialsRejectedMessageForTest = "Safe Tunnel access for this PI WEB was rejected or revoked. Enable Safe Tunnel to approve it again.";

describe("SafeTunnelRuntimeReconciler", () => {
  it("recovers persisted enabled intent and clamps hosted heartbeat intervals", async () => {
    const fixture = createFixture();
    fixture.safeTunnel.loaded = registeredEnabledState({ frpcPath: "/advanced/frpc" });
    fixture.safeTunnel.heartbeatResults = [
      () => Promise.resolve(heartbeatResult(1)),
      () => Promise.resolve(heartbeatResult(999)),
    ];

    await fixture.reconciler.startup();

    expect(fixture.runtime.startCalls).toEqual([{ advancedFrpcPath: "/advanced/frpc" }]);
    fixture.clock.advance(0);
    await waitForCondition(() => fixture.clock.scheduledDelays.at(-1) === 20_000);
    expect(fixture.safeTunnel.heartbeatCalls).toEqual([{ tunnelStatus: "running" }]);

    fixture.clock.advance(20_000);
    await waitForCondition(() => fixture.clock.scheduledDelays.at(-1) === 100_000);
    expect(fixture.safeTunnel.heartbeatCalls).toHaveLength(2);
    expect(fixture.runtime.stopCalls).toBe(0);
  });

  it("keeps heartbeating retrying supervision with capped recovery and no busy loop", async () => {
    const fixture = createFixture();
    fixture.safeTunnel.loaded = registeredEnabledState();
    fixture.runtime.statusValue = runtimeStatus({
      state: "unknown",
      error: "The owned frpc process failed. Retrying in 10 ms.",
    });
    fixture.safeTunnel.heartbeatResults = [
      () => Promise.reject(new Error("provider detail one")),
      () => Promise.reject(new Error("provider detail two")),
      () => Promise.reject(new Error("provider detail three")),
      () => Promise.resolve(heartbeatResult(30)),
    ];

    await fixture.reconciler.startup();
    fixture.runtime.statusValue = runtimeStatus({
      state: "unknown",
      error: "The owned frpc process failed. Retrying in 10 ms.",
    });
    fixture.clock.advance(0);
    await waitForCondition(() => fixture.clock.scheduledDelays.at(-1) === 10);

    fixture.clock.advance(10);
    await waitForCondition(() => fixture.clock.scheduledDelays.at(-1) === 20);
    fixture.clock.advance(20);
    await waitForCondition(() => fixture.clock.scheduledDelays.at(-1) === 40);
    expect(fixture.safeTunnel.heartbeatCalls).toEqual([
      { tunnelStatus: "error", errorMessage: "PI WEB Safe Tunnel runtime is recovering." },
      { tunnelStatus: "error", errorMessage: "PI WEB Safe Tunnel runtime is recovering." },
      { tunnelStatus: "error", errorMessage: "PI WEB Safe Tunnel runtime is recovering." },
    ]);
    const retryingStatus = await fixture.reconciler.status();
    expect(retryingStatus.state).toBe("unknown");
    expect(retryingStatus.diagnosticCode).toBe("heartbeat_retrying");
    expect(retryingStatus.error).toContain("Safe Tunnel heartbeat failed. Retrying in 40 ms.");
    expect(JSON.stringify(retryingStatus)).not.toContain("provider detail");

    fixture.clock.advance(40);
    await waitForCondition(() => fixture.clock.scheduledDelays.at(-1) === 30_000);
    expect(fixture.safeTunnel.heartbeatCalls).toHaveLength(4);
    expect(fixture.runtime.stopCalls).toBe(0);
  });

  it("retries revoked-child stops and requires an explicit re-registration start", async () => {
    const fixture = createFixture();
    fixture.safeTunnel.loaded = registeredEnabledState();
    fixture.safeTunnel.heartbeatResults = [() => Promise.reject(
      new SafeTunnelControlPlaneError("authentication_failed", "record_heartbeat"),
    )];
    fixture.runtime.stopResults = [
      () => Promise.reject(new Error("first unconfirmed stop")),
      () => Promise.reject(new Error("second unconfirmed stop")),
      () => Promise.resolve(runtimeStopOutput()),
    ];

    await fixture.reconciler.startup();
    fixture.clock.advance(0);
    await waitForCondition(() => fixture.clock.activeTaskCount() === 1);

    expect(fixture.runtime.stopCalls).toBe(1);
    expect(fixture.runtime.startCalls).toHaveLength(1);
    expect(fixture.safeTunnel.loaded.state.desiredState).toBe("enabled");
    const firstRetryStatus = await fixture.reconciler.status();
    expect(firstRetryStatus).toMatchObject({
      state: "running",
      diagnosticCode: "credentials_rejected",
    });
    expect(firstRetryStatus.error).toContain("Retrying in 10 ms");

    fixture.clock.advance(10);
    await waitForCondition(() => fixture.runtime.stopCalls === 2
      && fixture.clock.activeTaskCount() === 1);
    expect(fixture.runtime.startCalls).toHaveLength(1);
    const secondRetryStatus = await fixture.reconciler.status();
    expect(secondRetryStatus.diagnosticCode).toBe("credentials_rejected");
    expect(secondRetryStatus.error).toContain("Retrying in 20 ms");

    fixture.clock.advance(20);
    await waitForCondition(() => fixture.runtime.stopCalls === 3);
    expect(fixture.runtime.startCalls).toHaveLength(1);
    expect(fixture.clock.activeTaskCount()).toBe(0);
    await expect(fixture.reconciler.status()).resolves.toMatchObject({
      state: "stopped",
      diagnosticCode: "credentials_rejected",
      error: credentialsRejectedMessageForTest,
    });

    await fixture.reconciler.reconcile();
    expect(fixture.runtime.startCalls).toHaveLength(1);

    fixture.safeTunnel.heartbeatResults = [() => Promise.resolve(heartbeatResult(30))];
    await fixture.reconciler.start({});
    expect(fixture.runtime.startCalls).toHaveLength(2);
    fixture.clock.advance(0);
    await waitForCondition(() => fixture.safeTunnel.heartbeatCalls.length === 2);

    expect(fixture.safeTunnel.heartbeatCalls).toHaveLength(2);
    await expect(fixture.reconciler.status()).resolves.not.toHaveProperty("error");
  });

  it("stops when a heartbeat reports durably rejected credentials", async () => {
    const fixture = createFixture();
    fixture.safeTunnel.loaded = registeredEnabledState();
    fixture.safeTunnel.heartbeatResults = [() => Promise.reject(
      new SafeTunnelServiceError("credentials_rejected"),
    )];

    await fixture.reconciler.startup();
    fixture.clock.advance(0);
    await waitForCondition(() => fixture.runtime.stopCalls === 1);

    expect(fixture.clock.activeTaskCount()).toBe(0);
    await expect(fixture.reconciler.status()).resolves.toMatchObject({
      state: "stopped",
      diagnosticCode: "credentials_rejected",
    });
  });

  it("retries persisted-state reconciliation with capped exponential delays", async () => {
    const fixture = createFixture();
    fixture.safeTunnel.stateResults = [
      Promise.reject(new Error("private filesystem detail")),
      Promise.reject(new Error("private filesystem detail")),
      Promise.reject(new Error("private filesystem detail")),
      Promise.resolve(registeredEnabledState()),
    ];

    await fixture.reconciler.startup();
    expect(fixture.clock.scheduledDelays.at(-1)).toBe(10);
    await expect(fixture.reconciler.status()).resolves.toMatchObject({
      diagnosticCode: "state_retrying",
      error: "PI WEB could not reconcile persisted Safe Tunnel intent. Retrying in 10 ms.",
    });

    fixture.clock.advance(10);
    await flushAsyncWork();
    expect(fixture.clock.scheduledDelays.at(-1)).toBe(20);
    fixture.clock.advance(20);
    await flushAsyncWork();
    expect(fixture.clock.scheduledDelays.at(-1)).toBe(40);
    fixture.clock.advance(40);
    await flushAsyncWork();

    expect(fixture.runtime.startCalls).toEqual([{}]);
    expect(JSON.stringify(await fixture.reconciler.status())).not.toContain("filesystem detail");
  });

  it("contains detached reconciliation failures while retrying a disabled-intent stop", async () => {
    const fixture = createFixture();
    fixture.runtime.statusValue = runtimeStatus({ state: "running", pid: 4100 });
    fixture.safeTunnel.stateResults = [
      Promise.reject(new Error("private state read failure")),
      Promise.resolve({
        exists: true,
        state: createDefaultSafeTunnelState(),
      }),
    ];
    fixture.runtime.stopResults = [
      () => Promise.reject(new Error("first unconfirmed stop")),
      () => Promise.reject(new Error("second unconfirmed stop")),
      () => Promise.resolve(runtimeStopOutput()),
    ];
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (error: unknown): void => {
      unhandledRejections.push(error);
    };
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      await fixture.reconciler.startup();
      expect(fixture.clock.scheduledDelays.at(-1)).toBe(10);

      fixture.clock.advance(10);
      await waitForCondition(() => fixture.runtime.stopCalls === 1);
      await nextEventLoopTurn();
      expect(unhandledRejections).toEqual([]);
      expect(fixture.runtime.startCalls).toEqual([]);
      const firstRetryStatus = await fixture.reconciler.status();
      expect(firstRetryStatus).toMatchObject({
        state: "running",
        diagnosticCode: "runtime_recovery_failed",
      });
      expect(firstRetryStatus.error).toContain("Retrying in 10 ms");

      fixture.clock.advance(10);
      await waitForCondition(() => fixture.runtime.stopCalls === 2);
      expect(fixture.runtime.startCalls).toEqual([]);
      fixture.clock.advance(20);
      await waitForCondition(() => fixture.runtime.stopCalls === 3);
      await nextEventLoopTurn();

      expect(unhandledRejections).toEqual([]);
      expect(fixture.runtime.startCalls).toEqual([]);
      expect(fixture.clock.activeTaskCount()).toBe(0);
      await expect(fixture.reconciler.status()).resolves.toMatchObject({ state: "stopped" });
      await expect(fixture.reconciler.status()).resolves.not.toHaveProperty("error");
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });

  it("keeps missing registration stopped through stop recovery", async () => {
    const fixture = createFixture();
    fixture.safeTunnel.loaded = {
      exists: true,
      state: { ...createDefaultSafeTunnelState(), desiredState: "enabled" },
    };
    fixture.runtime.stopResults = [
      () => Promise.reject(new Error("unconfirmed stop")),
      () => Promise.resolve(runtimeStopOutput()),
    ];

    await fixture.reconciler.startup();

    expect(fixture.runtime.startCalls).toEqual([]);
    expect(fixture.runtime.stopCalls).toBe(1);
    const retryingStatus = await fixture.reconciler.status();
    expect(retryingStatus.diagnosticCode).toBe("registration_required");
    expect(retryingStatus.error).toContain("Retrying in 10 ms");

    fixture.safeTunnel.loaded = registeredEnabledState();
    fixture.clock.advance(10);
    await waitForCondition(() => fixture.runtime.stopCalls === 2);
    expect(fixture.runtime.startCalls).toEqual([]);

    await fixture.reconciler.reconcile();
    expect(fixture.runtime.startCalls).toEqual([{}]);
  });

  it("keeps durably rejected credentials stopped until a replacement registration", async () => {
    const fixture = createFixture();
    fixture.safeTunnel.loaded = registeredEnabledState();
    const machine = fixture.safeTunnel.loaded.state.machine;
    if (machine === undefined) throw new Error("registered fixture is missing a machine");
    fixture.safeTunnel.loaded = {
      ...fixture.safeTunnel.loaded,
      state: {
        ...fixture.safeTunnel.loaded.state,
        machine: { ...machine, credentialStatus: "rejected" },
      },
    };

    fixture.runtime.stopResults = [
      () => Promise.reject(new Error("unconfirmed stop")),
      () => Promise.resolve(runtimeStopOutput()),
    ];
    await fixture.reconciler.startup();

    expect(fixture.runtime.startCalls).toEqual([]);
    expect(fixture.runtime.stopCalls).toBe(1);
    const retryingStatus = await fixture.reconciler.status();
    expect(retryingStatus.diagnosticCode).toBe("credentials_rejected");
    expect(retryingStatus.error).toContain("Retrying in 10 ms");

    fixture.clock.advance(10);
    await waitForCondition(() => fixture.runtime.stopCalls === 2);
    expect(fixture.runtime.startCalls).toEqual([]);
    const stoppedStatus = await fixture.reconciler.status();
    expect(stoppedStatus.diagnosticCode).toBe("credentials_rejected");
    expect(stoppedStatus.error).toContain("approve it again");
  });

  it("does not replace supervision until a registration-change stop is confirmed", async () => {
    const fixture = createFixture();
    fixture.safeTunnel.loaded = registeredEnabledState();
    fixture.runtime.stopResults = [
      () => Promise.reject(new Error("first unconfirmed stop")),
      () => Promise.reject(new Error("second unconfirmed stop")),
      () => Promise.resolve(runtimeStopOutput()),
    ];

    await fixture.reconciler.startup();
    expect(fixture.runtime.startCalls).toEqual([{}]);

    await fixture.reconciler.reconcile();
    expect(fixture.runtime.stopCalls).toBe(1);
    expect(fixture.runtime.startCalls).toHaveLength(1);
    const retryingStatus = await fixture.reconciler.status();
    expect(retryingStatus.diagnosticCode).toBe("runtime_recovery_failed");
    expect(retryingStatus.error).toContain("Retrying in 10 ms");

    fixture.clock.advance(10);
    await waitForCondition(() => fixture.runtime.stopCalls === 2);
    expect(fixture.runtime.startCalls).toHaveLength(1);

    fixture.clock.advance(20);
    await waitForCondition(() => fixture.runtime.startCalls.length === 2);
    expect(fixture.runtime.stopCalls).toBe(3);
    await expect(fixture.reconciler.status()).resolves.not.toHaveProperty("error");
  });

  it("aborts and finishes heartbeat work before child shutdown", async () => {
    const order: string[] = [];
    const fixture = createFixture(order);
    fixture.safeTunnel.loaded = registeredEnabledState();
    fixture.safeTunnel.heartbeatResults = [pendingHeartbeatUntilAbort];

    await fixture.reconciler.startup();
    fixture.clock.advance(0);
    await flushAsyncWork();
    expect(order).toContain("heartbeat:start");

    await fixture.reconciler.shutdown();

    expect(order).toEqual([
      "runtime:start",
      "heartbeat:start",
      "heartbeat:abort",
      "runtime:shutdown",
    ]);
    expect(fixture.clock.activeTaskCount()).toBe(0);
  });

  it("cancels and joins stop recovery before supervisor shutdown", async () => {
    const fixture = createFixture();
    fixture.safeTunnel.loaded = registeredEnabledState();
    fixture.safeTunnel.heartbeatResults = [() => Promise.reject(
      new SafeTunnelControlPlaneError("authentication_failed", "record_heartbeat"),
    )];
    let rejectRecoveryStop: (reason?: unknown) => void = () => undefined;
    const recoveryStop = new Promise<SafeTunnelCommandOutput>((_resolve, reject) => {
      rejectRecoveryStop = reject;
    });
    fixture.runtime.stopResults = [
      () => Promise.reject(new Error("first unconfirmed stop")),
      () => recoveryStop,
    ];

    await fixture.reconciler.startup();
    fixture.clock.advance(0);
    await waitForCondition(() => fixture.runtime.stopCalls === 1
      && fixture.clock.activeTaskCount() === 1);

    fixture.clock.advance(10);
    await waitForCondition(() => fixture.runtime.stopCalls === 2);
    const shutdown = fixture.reconciler.shutdown();
    await flushAsyncWork();
    expect(fixture.runtime.shutdownCalls).toBe(0);
    expect(fixture.clock.activeTaskCount()).toBe(0);

    rejectRecoveryStop(new Error("second unconfirmed stop"));
    await expect(shutdown).resolves.toBeUndefined();
    expect(fixture.runtime.stopCalls).toBe(2);
    expect(fixture.runtime.shutdownCalls).toBe(1);
    expect(fixture.clock.activeTaskCount()).toBe(0);
  });

  it("shares shutdown completion across repeated callers", async () => {
    const fixture = createFixture();
    let finishShutdown = (): void => undefined;
    fixture.runtime.shutdownResult = new Promise((resolve) => { finishShutdown = resolve; });

    const firstShutdown = fixture.reconciler.shutdown();
    const secondShutdown = fixture.reconciler.shutdown();
    await waitForCondition(() => fixture.runtime.shutdownCalls === 1);

    let secondFinished = false;
    void secondShutdown.then(() => { secondFinished = true; });
    await flushAsyncWork();
    expect(secondFinished).toBe(false);

    finishShutdown();
    await Promise.all([firstShutdown, secondShutdown]);
    expect(fixture.runtime.shutdownCalls).toBe(1);
  });

  it("retries retained runtime ownership after an unconfirmed shutdown", async () => {
    const fixture = createFixture();
    const stopFailure = new Error("owned child stop was not confirmed");
    fixture.runtime.shutdownResult = Promise.reject(stopFailure);

    const firstShutdown = fixture.reconciler.shutdown();
    const concurrentShutdown = fixture.reconciler.shutdown();
    await expect(firstShutdown).rejects.toBe(stopFailure);
    await expect(concurrentShutdown).rejects.toBe(stopFailure);
    expect(fixture.runtime.shutdownCalls).toBe(1);

    fixture.runtime.shutdownResult = Promise.resolve();
    await expect(fixture.reconciler.shutdown()).resolves.toBeUndefined();
    expect(fixture.runtime.shutdownCalls).toBe(2);

    await expect(fixture.reconciler.shutdown()).resolves.toBeUndefined();
    expect(fixture.runtime.shutdownCalls).toBe(2);
  });

  it("leaves explicitly disabled intent stopped without scheduling heartbeats", async () => {
    const fixture = createFixture();

    await fixture.reconciler.startup();
    await fixture.reconciler.startup();

    expect(fixture.runtime.startCalls).toEqual([]);
    expect(fixture.runtime.stopCalls).toBe(1);
    expect(fixture.safeTunnel.heartbeatCalls).toEqual([]);
    expect(fixture.clock.activeTaskCount()).toBe(0);
  });
});

interface Fixture {
  readonly clock: ManualClock;
  readonly reconciler: SafeTunnelRuntimeReconciler;
  readonly runtime: FakeFrpcRuntime;
  readonly safeTunnel: FakeReconciliationService;
}

function createFixture(order: string[] = []): Fixture {
  const clock = new ManualClock();
  const runtime = new FakeFrpcRuntime(order);
  const safeTunnel = new FakeReconciliationService(order);
  return {
    clock,
    runtime,
    safeTunnel,
    reconciler: new SafeTunnelRuntimeReconciler({
      clock,
      policy,
      runtime,
      safeTunnel,
    }),
  };
}

class FakeReconciliationService implements SafeTunnelRuntimeReconciliationService {
  readonly heartbeatCalls: {
    readonly tunnelStatus: SafeTunnelHeartbeatTunnelStatus;
    readonly errorMessage?: string;
  }[] = [];
  heartbeatResults: (() => Promise<SafeTunnelMachineHeartbeat>)[] = [];
  loaded: LoadedSafeTunnelState = {
    exists: false,
    state: createDefaultSafeTunnelState(),
  };
  stateResults: Promise<LoadedSafeTunnelState>[] = [];

  constructor(private readonly order: string[]) {}

  recordHeartbeat(
    input: {
      readonly tunnelStatus: SafeTunnelHeartbeatTunnelStatus;
      readonly errorMessage?: string;
    },
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<SafeTunnelMachineHeartbeat> {
    this.heartbeatCalls.push(input);
    this.order.push("heartbeat:start");
    const result = (this.heartbeatResults.shift()
      ?? (() => Promise.resolve(heartbeatResult(30))))();
    if (options.signal === undefined) return result;
    const signal = options.signal;
    const onAbort = (): void => { this.order.push("heartbeat:abort"); };
    signal.addEventListener("abort", onAbort, { once: true });
    return abortableFake(result, signal).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  }

  state(): Promise<LoadedSafeTunnelState> {
    return this.stateResults.shift()
      ?? Promise.resolve(structuredClone(this.loaded));
  }
}

class FakeFrpcRuntime implements SafeTunnelFrpcRuntime {
  readonly startCalls: SafeTunnelFrpcStartInput[] = [];
  shutdownCalls = 0;
  shutdownResult: Promise<void> = Promise.resolve();
  statusValue: SafeTunnelRuntimeStatus = runtimeStatus();
  stopCalls = 0;
  stopResults: (() => Promise<SafeTunnelCommandOutput>)[] = [];

  constructor(private readonly order: string[]) {}

  shutdown(): Promise<void> {
    this.order.push("runtime:shutdown");
    this.shutdownCalls += 1;
    this.statusValue = runtimeStatus();
    return this.shutdownResult;
  }

  start(input: SafeTunnelFrpcStartInput): Promise<SafeTunnelFrpcStartResult> {
    this.order.push("runtime:start");
    this.startCalls.push(input);
    this.statusValue = runtimeStatus({ state: "running", pid: 4100 });
    return Promise.resolve({
      credentialRedactionValues: [],
      output: "PI WEB Safe Tunnel supervision started.\n",
      pid: 4100,
      publicUrl: "https://dev-box.ns.tunnels.pi-web.dev",
    });
  }

  status(): Promise<SafeTunnelRuntimeStatus> {
    return Promise.resolve(this.statusValue);
  }

  stop(): Promise<SafeTunnelCommandOutput> {
    this.order.push("runtime:stop");
    this.stopCalls += 1;
    const result = (this.stopResults.shift()
      ?? (() => Promise.resolve(runtimeStopOutput())))();
    return result.then((output) => {
      this.statusValue = runtimeStatus();
      return output;
    });
  }
}

class ManualClock implements SafeTunnelSupervisorClock {
  private currentMilliseconds = Date.parse("2026-07-29T00:00:00.000Z");
  private nextId = 1;
  readonly scheduledDelays: number[] = [];
  private readonly tasks = new Map<number, {
    readonly callback: () => void;
    readonly dueAt: number;
  }>();

  now(): Date {
    return new Date(this.currentMilliseconds);
  }

  schedule(callback: () => void, delayMs: number): SafeTunnelScheduledTask {
    const id = this.nextId;
    this.nextId += 1;
    this.scheduledDelays.push(delayMs);
    this.tasks.set(id, { callback, dueAt: this.currentMilliseconds + delayMs });
    return { cancel: () => { this.tasks.delete(id); } };
  }

  advance(milliseconds: number): void {
    const target = this.currentMilliseconds + milliseconds;
    for (;;) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.dueAt <= target)
        .sort((left, right) => left[1].dueAt - right[1].dueAt || left[0] - right[0])[0];
      if (next === undefined) break;
      const [id, task] = next;
      this.tasks.delete(id);
      this.currentMilliseconds = task.dueAt;
      task.callback();
    }
    this.currentMilliseconds = target;
  }

  activeTaskCount(): number {
    return this.tasks.size;
  }
}

function registeredEnabledState(
  overrides: Partial<LoadedSafeTunnelState["state"]> = {},
): LoadedSafeTunnelState {
  return {
    exists: true,
    state: {
      ...createDefaultSafeTunnelState(),
      desiredState: "enabled",
      machine: {
        controlApiBaseUrl: "https://control.example.test",
        machineId: "machine_123",
        machineToken: "piwt_mtok_v1_private",
        machineSlug: "dev-box",
        publicUrl: "https://dev-box.ns.tunnels.pi-web.dev",
      },
      ...overrides,
    },
  };
}

function heartbeatResult(nextHeartbeatSeconds: number): SafeTunnelMachineHeartbeat {
  return {
    machineId: "machine_123",
    lastSeenAt: "2026-07-29T00:00:00.000Z",
    nextHeartbeatSeconds,
  };
}

function runtimeStatus(
  overrides: Partial<SafeTunnelRuntimeStatus> = {},
): SafeTunnelRuntimeStatus {
  return {
    state: "stopped",
    frpcConfigPath: "/data/pi-web/safe-tunnel/frpc.toml",
    frpcConfigExists: false,
    logPath: "/data/pi-web/safe-tunnel/frpc.log",
    logExists: false,
    logTailMaxCharacters: 12_000,
    ...overrides,
  };
}

function runtimeStopOutput(): SafeTunnelCommandOutput {
  return {
    exitCode: 0,
    stderr: "",
    stdout: "PI WEB stopped its owned Safe Tunnel frpc process.\n",
  };
}

function pendingHeartbeatUntilAbort(): Promise<SafeTunnelMachineHeartbeat> {
  return new Promise(() => undefined);
}

function abortableFake<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("aborted"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error instanceof Error ? error : new Error("Unexpected fake failure."));
      },
    );
  });
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function nextEventLoopTurn(): Promise<void> {
  await new Promise<void>((resolve) => { setImmediate(resolve); });
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (condition()) return;
    await flushAsyncWork();
  }
  throw new Error("Expected asynchronous Safe Tunnel condition was not reached.");
}
