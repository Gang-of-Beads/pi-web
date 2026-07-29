import { describe, expect, it, vi } from "vitest";
import type {
  SafeTunnelCommandOutput,
  SafeTunnelRuntimeStatus,
} from "../../shared/apiTypes.js";
import type {
  SafeTunnelHeartbeatTunnelStatus,
  SafeTunnelMachineHeartbeat,
} from "./safeTunnelControlPlane.js";
import type {
  SafeTunnelEnableInput,
  SafeTunnelLoginInput,
  SafeTunnelLoginObserver,
  SafeTunnelLoginOptions,
  SafeTunnelLoginResult,
  SafeTunnelPreparedTunnelConfig,
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

    expect(status.config.state).toBe("rejected");
    expect(status.desiredState).toBe("enabled");
    expect(status.runtime.diagnosticCode).toBe("credentials_rejected");
    expect(status.config.machine).toMatchObject({
      machineId: "machine_123",
      publicUrl: "https://dev-box.ns.tunnels.pi-web.dev",
    });
    expect(JSON.stringify(status)).not.toContain("piwt_mtok_v1_private");
  });

  it("runs one inferred approval-through-supervision enable operation", async () => {
    const fixture = createFixture();
    const login = createDeferred<SafeTunnelLoginResult>();
    fixture.application.loginResult = login.promise;

    const response = await fixture.service.enable({});

    expect(response.accepted).toBe(true);
    expect(response.operation).toMatchObject({
      kind: "enable",
      phase: "preparing",
      status: "running",
    });
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
      publicNamespace: "ns",
    });
    expect(fixture.service.operation(response.operation.id)?.phase).toBe("registering");

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
  });

  it("reuses an active registration while updating its inferred local listener", async () => {
    const fixture = createFixture();
    fixture.application.loaded = registeredState({
      localPiWebUrl: "http://127.0.0.1:9999",
      frpcPath: "/persisted/frpc",
    });

    await fixture.service.enable({});
    await flushAsyncWork();

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

    await fixture.service.enable({
      advanced: {
        controlApiUrl: "http://127.0.0.1:8787",
        machineName: "Local Dev",
        machineSlug: "local-dev",
        localPiWebUrl: "http://127.0.0.1:9500",
        frpcPath: "/opt/frpc",
      },
    });

    expect(fixture.application.loginInput).toEqual({
      controlApiBaseUrl: "http://127.0.0.1:8787",
      machineName: "Local Dev",
      machineSlug: "local-dev",
      localPiWebUrl: "http://127.0.0.1:9500",
      frpcPath: "/opt/frpc",
    });
    login.resolve(loginResult());
    await flushAsyncWork();
    expect(fixture.application.enableCalls).toEqual([{
      localPiWebUrl: "http://127.0.0.1:9500",
      frpcPath: "/opt/frpc",
    }]);
    expect(fixture.runtime.startCalls).toEqual([{ advancedFrpcPath: "/opt/frpc" }]);
  });

  it("prevents a concurrent Disable from being overtaken by Enable preflight", async () => {
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

  it("still stops the owned child when disabled intent cannot be persisted", async () => {
    const fixture = createFixture();
    fixture.application.loaded = registeredState({ desiredState: "enabled" });
    fixture.application.disableError = new Error("state write failed");

    await expect(fixture.service.disable()).rejects.toThrow("state write failed");

    expect(fixture.order).toEqual(["disable", "runtime.stop"]);
  });

  it("reports invalid PI WEB state without exposing credentials", async () => {
    const fixture = createFixture();
    fixture.application.stateError = new Error(
      "Safe Tunnel desiredState must be enabled or disabled.",
    );

    const status = await fixture.service.status();

    expect(status.desiredState).toBe("disabled");
    expect(status.config).toMatchObject({
      path: fixture.application.statePath,
      state: "invalid",
      error: "Unable to read PI WEB Safe Tunnel state: Safe Tunnel desiredState must be enabled or disabled.",
    });
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
});

interface Fixture {
  readonly application: FakeSafeTunnelApplicationService;
  readonly order: string[];
  readonly runtime: FakeFrpcRuntime;
  readonly service: DefaultSafeTunnelBridgeService;
}

function createFixture(): Fixture {
  const order: string[] = [];
  const application = new FakeSafeTunnelApplicationService(
    "/data/pi-web/safe-tunnel/config.json",
    order,
  );
  const runtime = new FakeFrpcRuntime(order);
  let nowIndex = 0;
  return {
    application,
    order,
    runtime,
    service: new DefaultSafeTunnelBridgeService({
      enableDefaults: () => ({
        controlApiBaseUrl: "https://api.tunnels.pi-web.dev",
        localPiWebUrl: "http://127.0.0.1:8504",
        machineName: "dev-host",
        machineSlug: "dev-host-a1b2c3d4",
      }),
      fileExists: () => false,
      now: () => new Date(`2026-07-29T00:00:${(nowIndex += 1).toString().padStart(2, "0")}.000Z`),
      runtime,
      safeTunnel: application,
    }),
  };
}

class FakeFrpcRuntime implements SafeTunnelReconciledFrpcRuntime {
  shutdownCalls = 0;
  readonly startCalls: SafeTunnelFrpcStartInput[] = [];
  startupCalls = 0;
  startResult: Promise<SafeTunnelFrpcStartResult> = Promise.resolve({
    output: "Using verified PI WEB-managed frpc v0.69.1 for linux-arm64.\n",
    pid: 1234,
    publicUrl: "https://dev-box.ns.tunnels.pi-web.dev",
  });
  statusValue: SafeTunnelRuntimeStatus = runtimeStatus();
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
    this.shutdownCalls += 1;
    return Promise.resolve();
  }

  startup(): Promise<void> {
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
    return Promise.resolve(this.statusValue);
  }

  stop(): Promise<SafeTunnelCommandOutput> {
    this.order.push("runtime.stop");
    this.statusValue = runtimeStatus();
    return this.stopResult;
  }
}

class FakeSafeTunnelApplicationService implements SafeTunnelApplicationService {
  disableCalls = 0;
  disableError: Error | undefined;
  readonly enableCalls: SafeTunnelEnableInput[] = [];
  loaded: LoadedSafeTunnelState = {
    exists: false,
    state: createDefaultSafeTunnelState(),
  };
  loginCalls = 0;
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
    return abortable(this.loginResult, options.signal).then((result) => {
      this.loaded = {
        exists: true,
        state: {
          ...this.loaded.state,
          localPiWebUrl: input.localPiWebUrl ?? this.loaded.state.localPiWebUrl,
          machine: result.machineCredentials,
          ...(input.frpcPath === undefined ? {} : { frpcPath: input.frpcPath }),
        },
      };
      observer?.onMachineRegistered?.({
        id: result.registeredMachine.machine.id,
        publicUrl: result.registeredMachine.publicUrl,
      });
      return result;
    });
  }

  enable(input: SafeTunnelEnableInput = {}): Promise<SafeTunnelPersistedState> {
    this.order.push("enable");
    this.enableCalls.push(input);
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

  getTunnelConfig(): Promise<SafeTunnelPreparedTunnelConfig> {
    return Promise.resolve(preparedConfig());
  }

  recordHeartbeat(input: {
    readonly tunnelStatus: SafeTunnelHeartbeatTunnelStatus;
    readonly errorMessage?: string;
  }): Promise<SafeTunnelMachineHeartbeat> {
    return Promise.resolve({
      machineId: this.loaded.state.machine?.machineId ?? "machine_123",
      lastSeenAt: "2026-07-29T00:00:00.000Z",
      nextHeartbeatSeconds: input.tunnelStatus === "running" ? 30 : 10,
    });
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

function preparedConfig(): SafeTunnelPreparedTunnelConfig {
  return {
    machineId: "machine_123",
    publicHostname: "dev-box.ns.tunnels.pi-web.dev",
    publicUrl: "https://dev-box.ns.tunnels.pi-web.dev",
    localPiWebUrl: "http://127.0.0.1:8504",
    proxyName: "account-machine",
    frpcConfigToml: "[[proxies]]\n",
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
