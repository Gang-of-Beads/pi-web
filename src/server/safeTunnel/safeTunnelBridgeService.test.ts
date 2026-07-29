import { describe, expect, it } from "vitest";
import type {
  SafeTunnelCommandOutput,
  SafeTunnelRuntimeStatus,
} from "../../shared/apiTypes.js";
import type {
  SafeTunnelLoginInput,
  SafeTunnelLoginObserver,
  SafeTunnelLoginResult,
  SafeTunnelPreparedTunnelConfig,
} from "./safeTunnelService.js";
import {
  createDefaultSafeTunnelState,
  type LoadedSafeTunnelState,
  type SafeTunnelPersistedState,
} from "./safeTunnelState.js";
import type {
  SafeTunnelFrpcRuntime,
  SafeTunnelFrpcStartInput,
  SafeTunnelFrpcStartResult,
} from "./safeTunnelFrpcSupervisor.js";
import {
  DefaultSafeTunnelBridgeService,
  type SafeTunnelApplicationService,
} from "./safeTunnelBridgeService.js";

describe("DefaultSafeTunnelBridgeService", () => {
  it("maps PI WEB-owned intent, credentials, and direct runtime into status", async () => {
    const fixture = createFixture();
    fixture.application.loaded = registeredState({
      desiredState: "enabled",
      frpcPath: "/opt/frpc",
    });
    fixture.runtime.statusValue = runtimeStatus({ state: "running", pid: 4242 });

    const status = await fixture.service.status();

    expect(status.connector).toEqual({
      command: "PI WEB built-in frpc supervisor",
      state: "available",
    });
    expect(status.desiredState).toBe("enabled");
    expect(status.config).toEqual({
      path: fixture.application.statePath,
      exists: true,
      state: "registered",
      localPiWebUrl: "http://127.0.0.1:8504",
      frpcPathConfigured: true,
      machine: {
        controlApiBaseUrl: "https://control.example.test",
        machineId: "machine_123",
        machineSlug: "dev-box",
        publicHostname: "dev-box.ns.tunnels.pi-web.dev",
        publicUrl: "https://dev-box.ns.tunnels.pi-web.dev",
      },
    });
    expect(status.runtime).toMatchObject({ state: "running", pid: 4242 });
    expect(status.runtime.pidFilePath).toBeUndefined();
    expect(JSON.stringify(status)).not.toContain("piwt_mtok_v1_private");
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

  it("runs login inside PI WEB and never invokes the frpc runtime", async () => {
    const fixture = createFixture();
    const login = createDeferred<SafeTunnelLoginResult>();
    fixture.application.loginResult = login.promise;

    const response = await fixture.service.login({
      controlApiUrl: "https://control.example.test",
      machineName: "Dev Box",
      machineSlug: "dev-box",
      localPiWebUrl: "http://127.0.0.1:8504",
      frpcPath: "/opt/frpc",
    });

    expect(fixture.application.loginInput).toEqual({
      controlApiBaseUrl: "https://control.example.test",
      machineName: "Dev Box",
      machineSlug: "dev-box",
      localPiWebUrl: "http://127.0.0.1:8504",
      frpcPath: "/opt/frpc",
    });
    expect(response.operation.status).toBe("running");
    expect(fixture.runtime.startCalls).toEqual([]);

    fixture.application.loginObserver?.onDeviceAuthorization?.({
      deviceCode: "private-device-code",
      userCode: "ABCD-EFGH",
      verificationUri: "https://control.example.test/device",
      verificationUriComplete: "https://control.example.test/device?user_code=ABCD-EFGH",
      expiresAt: "2026-07-29T00:10:00.000Z",
      intervalSeconds: 5,
    });
    expect(fixture.service.operation(response.operation.id)).toMatchObject({
      userCode: "ABCD-EFGH",
      verificationUriComplete: "https://control.example.test/device?user_code=ABCD-EFGH",
    });
    expect(JSON.stringify(fixture.service.operation(response.operation.id)))
      .not.toContain("private-device-code");

    login.resolve(loginResult());
    await flushAsyncWork();
    expect(fixture.service.operation(response.operation.id)).toMatchObject({
      status: "succeeded",
      exitCode: 0,
      publicUrl: "https://dev-box.ns.tunnels.pi-web.dev",
    });
  });

  it("persists enabled intent before starting direct supervision", async () => {
    const fixture = createFixture();
    fixture.application.loaded = registeredState({ frpcPath: "/persisted/frpc" });
    const started = createDeferred<SafeTunnelFrpcStartResult>();
    fixture.runtime.startResult = started.promise;

    const response = await fixture.service.start({ frpcPath: "/advanced/frpc" });

    expect(fixture.order.slice(0, 2)).toEqual(["enable", "runtime.start"]);
    expect(fixture.application.enableCalls).toEqual(["/advanced/frpc"]);
    expect(fixture.runtime.startCalls).toEqual([{
      advancedFrpcPath: "/advanced/frpc",
    }]);
    expect(response.operation.status).toBe("running");
    expect(response.status.desiredState).toBe("enabled");

    started.resolve({
      output: "Using an advanced frpc path override.\nStarting PI WEB-owned Safe Tunnel frpc supervision.\n",
      pid: 1234,
      publicUrl: "https://dev-box.ns.tunnels.pi-web.dev",
    });
    await flushAsyncWork();

    const operation = fixture.service.operation(response.operation.id);
    expect(operation).toMatchObject({
      connectorProcessId: 1234,
      exitCode: 0,
      publicUrl: "https://dev-box.ns.tunnels.pi-web.dev",
      status: "succeeded",
    });
    expect(JSON.stringify(operation)).not.toContain("/advanced/frpc");
  });

  it("uses a persisted advanced path and otherwise selects managed frpc in the runtime", async () => {
    const persisted = createFixture();
    persisted.application.loaded = registeredState({ frpcPath: "/persisted/frpc" });
    await persisted.service.start({});
    expect(persisted.runtime.startCalls).toEqual([{
      advancedFrpcPath: "/persisted/frpc",
    }]);

    const managed = createFixture();
    managed.application.loaded = registeredState();
    await managed.service.start({});
    expect(managed.runtime.startCalls).toEqual([{}]);
  });

  it("persists disabled intent before stopping the owned process", async () => {
    const fixture = createFixture();
    fixture.application.loaded = registeredState({ desiredState: "enabled" });
    fixture.runtime.stopResult = Promise.resolve({
      exitCode: 0,
      stdout: "PI WEB stopped its owned Safe Tunnel frpc process.\n",
      stderr: "",
    });

    const response = await fixture.service.stop();

    expect(fixture.order.slice(0, 2)).toEqual(["disable", "runtime.stop"]);
    expect(fixture.application.loaded.state.desiredState).toBe("disabled");
    expect(response.command.stdout).toContain("owned Safe Tunnel frpc process");
  });

  it("still stops the owned child when disabled intent cannot be persisted", async () => {
    const fixture = createFixture();
    fixture.application.loaded = registeredState({ desiredState: "enabled" });
    fixture.application.disableError = new Error("state write failed");

    await expect(fixture.service.stop()).rejects.toThrow("state write failed");

    expect(fixture.order).toEqual(["disable", "runtime.stop"]);
  });

  it("shuts down the process runtime without erasing persisted enabled intent", async () => {
    const fixture = createFixture();
    fixture.application.loaded = registeredState({ desiredState: "enabled" });

    await fixture.service.shutdown();

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
      fileExists: () => false,
      now: () => new Date(`2026-07-29T00:00:0${(nowIndex += 1).toString()}.000Z`),
      runtime,
      safeTunnel: application,
    }),
  };
}

class FakeFrpcRuntime implements SafeTunnelFrpcRuntime {
  shutdownCalls = 0;
  readonly startCalls: SafeTunnelFrpcStartInput[] = [];
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

  shutdown(): Promise<void> {
    this.shutdownCalls += 1;
    return Promise.resolve();
  }

  start(input: SafeTunnelFrpcStartInput): Promise<SafeTunnelFrpcStartResult> {
    this.order.push("runtime.start");
    this.startCalls.push(input);
    this.statusValue = runtimeStatus({ state: "unknown" });
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
  readonly enableCalls: (string | undefined)[] = [];
  loaded: LoadedSafeTunnelState = {
    exists: false,
    state: createDefaultSafeTunnelState(),
  };
  loginInput: SafeTunnelLoginInput | undefined;
  loginObserver: SafeTunnelLoginObserver | undefined;
  loginResult: Promise<SafeTunnelLoginResult> = Promise.resolve(loginResult());
  stateError: Error | undefined;

  constructor(
    readonly statePath: string,
    private readonly order: string[],
  ) {}

  state(): Promise<LoadedSafeTunnelState> {
    return this.stateError === undefined
      ? Promise.resolve(structuredClone(this.loaded))
      : Promise.reject(this.stateError);
  }

  login(
    input: SafeTunnelLoginInput,
    observer?: SafeTunnelLoginObserver,
  ): Promise<SafeTunnelLoginResult> {
    this.loginInput = input;
    this.loginObserver = observer;
    return this.loginResult;
  }

  enable(frpcPath?: string): Promise<SafeTunnelPersistedState> {
    this.order.push("enable");
    this.enableCalls.push(frpcPath);
    this.loaded = {
      exists: true,
      state: {
        ...this.loaded.state,
        desiredState: "enabled",
        ...(frpcPath === undefined ? {} : { frpcPath }),
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

async function flushAsyncWork(): Promise<void> {
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
