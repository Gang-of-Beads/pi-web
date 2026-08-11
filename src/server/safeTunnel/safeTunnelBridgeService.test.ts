import { describe, expect, it, vi } from "vitest";
import type {
  SafeTunnelCommandOutput,
  SafeTunnelRuntimeStatus,
} from "../../shared/apiTypes.js";
import { SafeTunnelOperationConflictError } from "./safeTunnelRoutes.js";
import type {
  SafeTunnelEnableInput,
  SafeTunnelLoginInput,
  SafeTunnelLoginObserver,
  SafeTunnelLoginOptions,
  SafeTunnelLoginResult,
} from "./safeTunnelService.js";
import {
  createDefaultSafeTunnelState,
  type LoadedSafeTunnelState,
  type SafeTunnelPersistedState,
} from "./safeTunnelState.js";
import type {
  SafeTunnelFrpcStartInput,
  SafeTunnelFrpcStartResult,
} from "./safeTunnelFrpcSupervisor.js";
import type { SafeTunnelReconciledFrpcRuntime } from "./safeTunnelRuntimeReconciler.js";
import {
  DefaultSafeTunnelBridgeService,
  type SafeTunnelApplicationService,
} from "./safeTunnelBridgeService.js";

describe("DefaultSafeTunnelBridgeService", () => {
  it("maps private state and structured revocation diagnostics without credentials", async () => {
    const fixture = createFixture();
    fixture.application.loaded = registeredState({
      desiredState: "enabled",
      machine: {
        ...registeredState().state.machine ?? missingMachineCredentials(),
        credentialStatus: "rejected",
      },
    });
    fixture.runtime.statusValue = runtimeStatus({
      diagnosticCode: "credentials_rejected",
      error: "Safe Tunnel access was revoked.",
    });

    const status = await fixture.service.status();

    expect(status.config).toMatchObject({
      path: fixture.application.statePath,
      state: "rejected",
      machine: {
        machineId: "machine_123",
        publicHostname: "dev-box.ns.tunnels.pi-web.dev",
        publicUrl: "https://dev-box.ns.tunnels.pi-web.dev",
      },
    });
    expect(status.desiredState).toBe("enabled");
    expect(status.runtime.diagnosticCode).toBe("credentials_rejected");
    expect(JSON.stringify(status)).not.toContain("piwt_mtok_v1_private");
  });

  it("reports invalid owned state with a fixed browser-safe diagnostic", async () => {
    const fixture = createFixture();
    fixture.application.stateError = new Error(
      "private state parse failure containing piwt_mtok_v1_private",
    );
    fixture.fileSystem.error = new Error("private filesystem failure");

    const status = await fixture.service.status();

    expect(status).toMatchObject({
      config: {
        path: fixture.application.statePath,
        exists: false,
        state: "invalid",
        error: "Unable to read PI WEB Safe Tunnel state.",
      },
      desiredState: "disabled",
    });
    expect(JSON.stringify(status)).not.toContain("private");
    expect(fixture.fileExistsPaths).toEqual([fixture.application.statePath]);
  });

  it("bounds every runtime diagnostic field at the browser boundary", async () => {
    const fixture = createFixture();
    fixture.runtime.statusValue = runtimeStatus({
      error: `error-${"e".repeat(3_000)}`,
      frpcConfigPath: `/private/${"c".repeat(5_000)}`,
      logError: `log-error-${"d".repeat(3_000)}`,
      logPath: `/private/${"l".repeat(5_000)}`,
      logTail: `${"old".repeat(5_000)}latest`,
    });

    const runtime = (await fixture.service.status()).runtime;

    expect(runtime.error).toHaveLength(2_000);
    expect(runtime.logError).toHaveLength(2_000);
    expect(runtime.frpcConfigPath).toHaveLength(4_096);
    expect(runtime.logPath).toHaveLength(4_096);
    expect(runtime.logTail).toHaveLength(12_000);
    expect(runtime.logTail).toMatch(/latest$/u);
    expect(runtime.logTailMaxCharacters).toBe(12_000);
  });

  it("runs one deterministic approval-through-supervision enable operation", async () => {
    const fixture = createFixture();
    const login = createDeferred<SafeTunnelLoginResult>();
    fixture.application.loginResult = login.promise;

    const response = await fixture.service.enable({});
    await vi.waitFor(() => { expect(fixture.application.loginCalls).toBe(1); });

    expect(response).toMatchObject({
      accepted: true,
      operation: {
        id: "operation-1",
        kind: "enable",
        phase: "preparing",
        status: "running",
      },
      status: {
        activeOperation: { id: "operation-1", phase: "preparing" },
        config: { path: fixture.application.statePath, state: "missing" },
        desiredState: "disabled",
      },
    });
    expect(response.status.activeOperation).not.toBe(response.operation);
    expect(fixture.application.loginInput).toEqual({
      controlApiBaseUrl: "https://api.tunnels.pi-web.dev",
      localPiWebUrl: "http://127.0.0.1:8504",
      machineName: "dev-host",
      machineSlug: "dev-host-a1b2c3d4",
    });
    expect(fixture.runtime.startCalls).toEqual([]);

    fixture.application.loginObserver?.onDeviceAuthorization?.({
      deviceCode: "private-device-code",
      userCode: "ABCD-EFGH",
      verificationUri: "https://api.tunnels.pi-web.dev/device",
      verificationUriComplete: "https://api.tunnels.pi-web.dev/device?user_code=ABCD-EFGH",
      expiresAt: "2026-07-29T00:10:00.000Z",
      intervalSeconds: 5,
    });
    expect(fixture.service.operation(response.operation.id)).toMatchObject({
      phase: "awaiting_approval",
      userCode: "ABCD-EFGH",
      verificationUriComplete: "https://api.tunnels.pi-web.dev/device?user_code=ABCD-EFGH",
    });
    expect(JSON.stringify(fixture.service.operation(response.operation.id)))
      .not.toContain("private-device-code");

    fixture.application.loginObserver?.onAuthorizationApproved?.({
      id: "account_123",
      publicNamespace: "private-provider-namespace",
    });
    expect(fixture.service.operation(response.operation.id)?.phase).toBe("registering");
    expect(fixture.service.operation(response.operation.id)?.stdout)
      .not.toContain("private-provider-namespace");

    login.resolve(loginResult());
    await vi.waitFor(() => {
      expect(fixture.service.operation(response.operation.id)?.status).toBe("succeeded");
    });

    expect(fixture.order).toEqual(["login", "enable", "runtime.start"]);
    expect(fixture.application.enableCalls).toEqual([{
      localPiWebUrl: "http://127.0.0.1:8504",
    }]);
    expect(fixture.runtime.startCalls).toEqual([{}]);
    expect(fixture.service.operation(response.operation.id)).toMatchObject({
      phase: "enabled",
      status: "succeeded",
      exitCode: 0,
      publicUrl: "https://dev-box.ns.tunnels.pi-web.dev",
    });
    expect(response.operation).toMatchObject({ phase: "preparing", status: "running" });
    expect(JSON.stringify(fixture.service.operation(response.operation.id)))
      .not.toContain("piwt_mtok_v1_private");
  });

  it("reuses an active registration while updating its inferred local listener", async () => {
    const fixture = createFixture();
    fixture.application.loaded = registeredState({
      localPiWebUrl: "http://127.0.0.1:9999",
      frpcPath: "/persisted/frpc",
    });

    const response = await fixture.service.enable({});
    await vi.waitFor(() => {
      expect(fixture.service.operation(response.operation.id)?.status).toBe("succeeded");
    });

    expect(fixture.application.loginCalls).toBe(0);
    expect(fixture.application.enableCalls).toEqual([{
      localPiWebUrl: "http://127.0.0.1:8504",
    }]);
    expect(fixture.runtime.startCalls).toEqual([{
      advancedFrpcPath: "/persisted/frpc",
    }]);
  });

  it("applies advanced self-hosting overrides only when supplied", async () => {
    const fixture = createFixture();
    const login = createDeferred<SafeTunnelLoginResult>();
    fixture.application.loaded = registeredState();
    fixture.application.loginResult = login.promise;

    const response = await fixture.service.enable({
      advanced: {
        controlApiUrl: "http://127.0.0.1:8787",
        machineName: "Local Dev",
        machineSlug: "local-dev",
        localPiWebUrl: "http://127.0.0.1:9500",
        frpcPath: "/opt/frpc",
      },
    });
    await vi.waitFor(() => { expect(fixture.application.loginCalls).toBe(1); });

    expect(fixture.application.loginInput).toEqual({
      controlApiBaseUrl: "http://127.0.0.1:8787",
      machineName: "Local Dev",
      machineSlug: "local-dev",
      localPiWebUrl: "http://127.0.0.1:9500",
      frpcPath: "/opt/frpc",
    });

    login.resolve(loginResult());
    await vi.waitFor(() => {
      expect(fixture.service.operation(response.operation.id)?.status).toBe("succeeded");
    });
    expect(fixture.application.enableCalls).toEqual([{
      localPiWebUrl: "http://127.0.0.1:9500",
      frpcPath: "/opt/frpc",
    }]);
    expect(fixture.runtime.startCalls).toEqual([{ advancedFrpcPath: "/opt/frpc" }]);
  });

  it("uses fixed route conflicts for running and concurrent enablement", async () => {
    const running = createFixture();
    running.application.loaded = registeredState({ desiredState: "enabled" });
    running.runtime.statusValue = runtimeStatus({ state: "running", pid: 1234 });

    await expect(running.service.enable({})).rejects.toEqual(
      expect.objectContaining<Partial<SafeTunnelOperationConflictError>>({
        code: "already_enabled",
      }),
    );

    const active = createFixture();
    active.application.loginResult = new Promise(() => undefined);
    const first = await active.service.enable({});
    await vi.waitFor(() => { expect(active.application.loginCalls).toBe(1); });

    await expect(active.service.enable({})).rejects.toEqual(
      expect.objectContaining<Partial<SafeTunnelOperationConflictError>>({
        code: "operation_in_progress",
      }),
    );
    await active.service.disable();
    expect(active.service.operation(first.operation.id)?.status).toBe("cancelled");
  });

  it("prevents Disable from being overtaken by Enable preflight", async () => {
    const fixture = createFixture();
    const state = createDeferred<LoadedSafeTunnelState>();
    fixture.application.stateResult = state.promise;

    const enabling = fixture.service.enable({});
    await Promise.resolve();
    const disabling = fixture.service.disable();
    state.resolve({ exists: false, state: createDefaultSafeTunnelState() });

    await expect(enabling).rejects.toThrow("cancelled");
    await expect(disabling).resolves.toMatchObject({
      status: { desiredState: "disabled" },
    });
    expect(fixture.runtime.startCalls).toEqual([]);
    expect(fixture.order).toEqual(["disable", "runtime.stop"]);
  });

  it("cancels approval work and persists disabled intent before stopping", async () => {
    const fixture = createFixture();
    fixture.application.loginResult = new Promise(() => undefined);
    const enable = await fixture.service.enable({});
    await vi.waitFor(() => { expect(fixture.application.loginCalls).toBe(1); });

    const disabled = await fixture.service.disable();

    expect(fixture.application.loginSignal?.aborted).toBe(true);
    expect(fixture.order).toEqual(["login", "disable", "runtime.stop"]);
    expect(fixture.service.operation(enable.operation.id)).toMatchObject({
      status: "cancelled",
      error: "Safe Tunnel enablement was cancelled.",
    });
    expect(disabled.status.desiredState).toBe("disabled");
    expect(fixture.runtime.startCalls).toEqual([]);
  });

  it("waits for in-flight registration without letting late callbacks revive cancellation", async () => {
    const fixture = createFixture();
    const login = createDeferred<SafeTunnelLoginResult>();
    fixture.application.loginHonorsAbort = false;
    fixture.application.loginResult = login.promise;
    const enabled = await fixture.service.enable({});
    await vi.waitFor(() => { expect(fixture.application.loginCalls).toBe(1); });
    fixture.application.loginObserver?.onAuthorizationApproved?.({
      id: "account_123",
      publicNamespace: "namespace",
    });

    let disableSettled = false;
    const disabling = fixture.service.disable().then((result) => {
      disableSettled = true;
      return result;
    });
    await flushAsyncWork();

    expect(disableSettled).toBe(false);
    expect(fixture.order).toEqual(["login", "disable", "runtime.stop"]);
    expect(fixture.service.operation(enabled.operation.id)).toMatchObject({
      phase: "registering",
      status: "cancelled",
    });

    login.resolve(loginResult());
    await disabling;

    expect(fixture.service.operation(enabled.operation.id)).toMatchObject({
      phase: "registering",
      status: "cancelled",
    });
    expect(fixture.service.operation(enabled.operation.id)?.publicUrl).toBeUndefined();
    expect(fixture.application.enableCalls).toEqual([]);
    expect(fixture.runtime.startCalls).toEqual([]);
  });

  it("still stops the owned child and preserves the state error when disable persistence fails", async () => {
    const fixture = createFixture();
    fixture.application.loaded = registeredState({ desiredState: "enabled" });
    fixture.application.disableError = new Error("state write failed");
    fixture.runtime.stopError = new Error("private child failure");

    await expect(fixture.service.disable()).rejects.toThrow("state write failed");

    expect(fixture.order).toEqual(["disable", "runtime.stop"]);
    expect(fixture.runtime.stopCalls).toBe(1);
  });

  it("keeps operation failures generic and caps successful command output", async () => {
    const failed = createFixture();
    failed.application.loaded = registeredState();
    failed.runtime.startResult = Promise.reject(
      new Error("private transport cause with piwt_mtok_v1_private"),
    );

    const failureResponse = await failed.service.enable({});
    await vi.waitFor(() => {
      expect(failed.service.operation(failureResponse.operation.id)?.status).toBe("failed");
    });
    expect(failed.service.operation(failureResponse.operation.id)).toMatchObject({
      error: "Safe Tunnel enablement failed.",
      status: "failed",
    });
    expect(JSON.stringify(failed.service.operation(failureResponse.operation.id)))
      .not.toContain("private transport");

    const succeeded = createFixture();
    succeeded.application.loaded = registeredState();
    succeeded.runtime.startResult = Promise.resolve({
      output: "x".repeat(30_000),
      pid: 1234,
      publicUrl: "https://dev-box.ns.tunnels.pi-web.dev",
    });

    const successResponse = await succeeded.service.enable({});
    await vi.waitFor(() => {
      expect(succeeded.service.operation(successResponse.operation.id)?.status).toBe("succeeded");
    });
    const operation = succeeded.service.operation(successResponse.operation.id);
    expect(operation?.stdout).toHaveLength(24_000);
    expect(operation?.logTail).toHaveLength(12_000);
    expect(operation?.logTailMaxCharacters).toBe(12_000);
  });

  it("delegates startup and shuts down without erasing enabled intent", async () => {
    const fixture = createFixture();
    fixture.application.loaded = registeredState({ desiredState: "enabled" });

    await fixture.service.startup();
    await fixture.service.shutdown();

    expect(fixture.runtime.startupCalls).toBe(1);
    expect(fixture.runtime.shutdownCalls).toBe(1);
    expect(fixture.application.disableCalls).toBe(0);
    expect(fixture.application.loaded.state.desiredState).toBe("enabled");
  });

  it("stops runtime ownership before waiting for cancelled registration on shutdown", async () => {
    const fixture = createFixture();
    const login = createDeferred<SafeTunnelLoginResult>();
    fixture.application.loginHonorsAbort = false;
    fixture.application.loginResult = login.promise;
    const enabled = await fixture.service.enable({});
    await vi.waitFor(() => { expect(fixture.application.loginCalls).toBe(1); });

    let shutdownSettled = false;
    const shutdown = fixture.service.shutdown().then(() => { shutdownSettled = true; });
    await flushAsyncWork();

    expect(fixture.runtime.shutdownCalls).toBe(1);
    expect(shutdownSettled).toBe(false);
    expect(fixture.service.operation(enabled.operation.id)?.status).toBe("cancelled");

    login.resolve(loginResult());
    await shutdown;

    expect(fixture.application.enableCalls).toEqual([]);
    expect(fixture.runtime.startCalls).toEqual([]);
    expect(fixture.order).toEqual(["login", "runtime.shutdown"]);
  });
});

interface Fixture {
  readonly application: FakeSafeTunnelApplicationService;
  readonly fileExistsPaths: string[];
  readonly fileSystem: { error: Error | undefined };
  readonly order: string[];
  readonly runtime: FakeFrpcRuntime;
  service: DefaultSafeTunnelBridgeService;
}

function createFixture(): Fixture {
  const order: string[] = [];
  const application = new FakeSafeTunnelApplicationService(
    "/data/pi-web/safe-tunnel/config.json",
    order,
  );
  const runtime = new FakeFrpcRuntime(order);
  const fileExistsPaths: string[] = [];
  const fileSystem: { error: Error | undefined } = { error: undefined };
  let nowIndex = 0;
  let operationIndex = 0;
  const service = new DefaultSafeTunnelBridgeService({
    createOperationId: () => `operation-${(operationIndex += 1).toString()}`,
    enableDefaults: () => ({
      controlApiBaseUrl: "https://api.tunnels.pi-web.dev",
      localPiWebUrl: "http://127.0.0.1:8504",
      machineName: "dev-host",
      machineSlug: "dev-host-a1b2c3d4",
    }),
    fileExists: (path) => {
      fileExistsPaths.push(path);
      if (fileSystem.error !== undefined) throw fileSystem.error;
      return false;
    },
    now: () => new Date(
      `2026-07-29T00:00:${(nowIndex += 1).toString().padStart(2, "0")}.000Z`,
    ),
    runtime,
    safeTunnel: application,
  });
  return {
    application,
    fileExistsPaths,
    fileSystem,
    order,
    runtime,
    service,
  };
}

class FakeFrpcRuntime implements SafeTunnelReconciledFrpcRuntime {
  shutdownCalls = 0;
  shutdownError: Error | undefined;
  readonly startCalls: SafeTunnelFrpcStartInput[] = [];
  startupCalls = 0;
  startResult: Promise<SafeTunnelFrpcStartResult> = Promise.resolve({
    output: "Using verified PI WEB-managed frpc v0.69.1 for linux-arm64.\n",
    pid: 1234,
    publicUrl: "https://dev-box.ns.tunnels.pi-web.dev",
  });
  statusValue: SafeTunnelRuntimeStatus = runtimeStatus();
  stopCalls = 0;
  stopError: Error | undefined;
  stopResult: Promise<SafeTunnelCommandOutput> = Promise.resolve({
    exitCode: 0,
    stdout: "No running PI WEB Safe Tunnel frpc process was found.\n",
    stderr: "",
  });

  constructor(private readonly order: string[]) {}

  reconcile(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    this.order.push("runtime.shutdown");
    this.shutdownCalls += 1;
    return this.shutdownError === undefined
      ? Promise.resolve()
      : Promise.reject(this.shutdownError);
  }

  startup(): Promise<void> {
    this.order.push("runtime.startup");
    this.startupCalls += 1;
    return Promise.resolve();
  }

  start(input: SafeTunnelFrpcStartInput): Promise<SafeTunnelFrpcStartResult> {
    this.order.push("runtime.start");
    this.startCalls.push(input);
    return this.startResult.then((result) => {
      this.statusValue = runtimeStatus({
        state: "running",
        ...(result.pid === undefined ? {} : { pid: result.pid }),
      });
      return result;
    });
  }

  status(): Promise<SafeTunnelRuntimeStatus> {
    return Promise.resolve({ ...this.statusValue });
  }

  stop(): Promise<SafeTunnelCommandOutput> {
    this.order.push("runtime.stop");
    this.stopCalls += 1;
    this.statusValue = runtimeStatus();
    return this.stopError === undefined
      ? this.stopResult
      : Promise.reject(this.stopError);
  }
}

class FakeSafeTunnelApplicationService implements SafeTunnelApplicationService {
  disableCalls = 0;
  disableError: Error | undefined;
  readonly enableCalls: SafeTunnelEnableInput[] = [];
  enableError: Error | undefined;
  loaded: LoadedSafeTunnelState = {
    exists: false,
    state: createDefaultSafeTunnelState(),
  };
  loginCalls = 0;
  loginHonorsAbort = true;
  loginInput: SafeTunnelLoginInput | undefined;
  loginObserver: SafeTunnelLoginObserver | undefined;
  loginResult: Promise<SafeTunnelLoginResult> = Promise.resolve(loginResult());
  loginSignal: AbortSignal | undefined;
  stateError: Error | undefined;
  stateResult: Promise<LoadedSafeTunnelState> | undefined;

  constructor(
    readonly statePath: string,
    private readonly order: string[],
  ) {}

  state(): Promise<LoadedSafeTunnelState> {
    if (this.stateError !== undefined) return Promise.reject(this.stateError);
    return this.stateResult ?? Promise.resolve(structuredClone(this.loaded));
  }

  login(
    input: SafeTunnelLoginInput,
    observer?: SafeTunnelLoginObserver,
    options: SafeTunnelLoginOptions = {},
  ): Promise<SafeTunnelLoginResult> {
    this.order.push("login");
    this.loginCalls += 1;
    this.loginInput = input;
    this.loginObserver = observer;
    this.loginSignal = options.signal;
    const result = this.loginHonorsAbort
      ? abortable(this.loginResult, options.signal)
      : this.loginResult;
    return result.then((login) => {
      this.loaded = {
        exists: true,
        state: {
          ...this.loaded.state,
          localPiWebUrl: input.localPiWebUrl ?? this.loaded.state.localPiWebUrl,
          machine: login.machineCredentials,
          ...(input.frpcPath === undefined ? {} : { frpcPath: input.frpcPath }),
        },
      };
      observer?.onMachineRegistered?.({
        id: login.registeredMachine.machine.id,
        publicUrl: login.registeredMachine.publicUrl,
      });
      return login;
    });
  }

  enable(input: SafeTunnelEnableInput = {}): Promise<SafeTunnelPersistedState> {
    this.order.push("enable");
    this.enableCalls.push(input);
    if (this.enableError !== undefined) return Promise.reject(this.enableError);
    this.loaded = {
      exists: true,
      state: {
        ...this.loaded.state,
        desiredState: "enabled",
        ...(input.localPiWebUrl === undefined ? {} : { localPiWebUrl: input.localPiWebUrl }),
        ...(input.frpcPath === undefined ? {} : { frpcPath: input.frpcPath }),
      },
    };
    return Promise.resolve(this.loaded.state);
  }

  disable(): Promise<SafeTunnelPersistedState> {
    this.order.push("disable");
    this.disableCalls += 1;
    if (this.disableError !== undefined) return Promise.reject(this.disableError);
    this.loaded = {
      exists: true,
      state: { ...this.loaded.state, desiredState: "disabled" },
    };
    return Promise.resolve(this.loaded.state);
  }
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

function registeredState(
  overrides: Partial<SafeTunnelPersistedState> = {},
): LoadedSafeTunnelState {
  return {
    exists: true,
    state: {
      ...createDefaultSafeTunnelState(),
      machine: {
        controlApiBaseUrl: "https://control.example.test",
        credentialStatus: "active",
        machineId: "machine_123",
        machineToken: "piwt_mtok_v1_private",
        machineSlug: "dev-box",
        publicUrl: "https://dev-box.ns.tunnels.pi-web.dev",
      },
      ...overrides,
    },
  };
}

function loginResult(): SafeTunnelLoginResult {
  return {
    machineCredentials: registeredState().state.machine ?? missingMachineCredentials(),
    registeredMachine: {
      machine: {
        id: "machine_123",
        accountId: "account_123",
        name: "Dev Box",
        slug: "dev-box",
      },
      publicHostname: "dev-box.ns.tunnels.pi-web.dev",
      publicUrl: "https://dev-box.ns.tunnels.pi-web.dev",
      machineToken: "piwt_mtok_v1_private",
    },
  };
}

function missingMachineCredentials(): never {
  throw new Error("Registered fixture is missing machine credentials");
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return promise;
  if (signal.aborted) return Promise.reject(new Error("cancelled"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(new Error("cancelled")); };
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
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

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
