import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SafeTunnelLoginInput, SafeTunnelLoginObserver, SafeTunnelLoginResult } from "./safeTunnelService.js";
import {
  createDefaultSafeTunnelState,
  safeTunnelConnectorConfigPathEnvVar,
  type LoadedSafeTunnelState,
  type SafeTunnelPersistedState,
} from "./safeTunnelState.js";
import {
  createNodeSafeTunnelCommandRunner,
  DefaultSafeTunnelBridgeService,
  type SafeTunnelApplicationService,
  type SafeTunnelCommandRunner,
  type SafeTunnelCommandRunOptions,
  type SafeTunnelCommandRunResult,
} from "./safeTunnelBridgeService.js";

let tempDirectory: string;
let runner: FakeCommandRunner;
let application: FakeSafeTunnelApplicationService;
let service: DefaultSafeTunnelBridgeService;
let nowIndex: number;

beforeEach(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), "pi-web-safe-tunnel-bridge-"));
  const statePath = join(tempDirectory, "safe-tunnel", "config.json");
  runner = new FakeCommandRunner();
  runner.statusJson = connectorStatusJson(statePath);
  application = new FakeSafeTunnelApplicationService(statePath);
  nowIndex = 0;
  service = new DefaultSafeTunnelBridgeService({
    commandRunner: runner,
    connectorCommandEnvironment: { [safeTunnelConnectorConfigPathEnvVar]: statePath },
    cwd: process.cwd(),
    env: { PI_WEB_SAFE_TUNNEL_CONNECTOR_COMMAND: "/usr/local/bin/pi-web-tunnel" },
    fileExists: existsSync,
    homeDirectory: tempDirectory,
    now: () => new Date(`2026-07-29T00:00:0${(nowIndex += 1).toString()}.000Z`),
    platform: "linux",
    safeTunnel: application,
  });
});

afterEach(async () => {
  await rm(tempDirectory, { recursive: true, force: true });
});

describe("DefaultSafeTunnelBridgeService", () => {
  it("maps PI WEB-owned intent and redacted credentials into the stable status contract", async () => {
    application.loaded = registeredState({ desiredState: "enabled", frpcPath: "/opt/frpc" });
    runner.statusJson = connectorStatusJson(application.statePath, {
      runtime: { state: "running", pid: 4242, frpcConfigExists: true },
    });

    const status = await service.status();

    expect(status.desiredState).toBe("enabled");
    expect(status.config).toEqual({
      path: application.statePath,
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
    expect(JSON.stringify(status)).not.toContain("piwt_mtok_v1_private");
    expect(runner.runOptions[0]?.environment).toEqual({
      [safeTunnelConnectorConfigPathEnvVar]: application.statePath,
    });
  });

  it("reports invalid PI WEB state without exposing a credential-bearing error cause", async () => {
    application.stateError = new Error("Safe Tunnel desiredState must be enabled or disabled.");

    const status = await service.status();

    expect(status.desiredState).toBe("disabled");
    expect(status.config).toMatchObject({
      path: application.statePath,
      state: "invalid",
      error: "Unable to read PI WEB Safe Tunnel state: Safe Tunnel desiredState must be enabled or disabled.",
    });
  });

  it("runs login inside PI WEB, tracks approval directly, and never invokes connector login", async () => {
    const loginDeferred = createDeferred<SafeTunnelLoginResult>();
    application.loginResult = loginDeferred.promise;

    const response = await service.login({
      controlApiUrl: "https://control.example.test",
      machineName: "Dev Box",
      machineSlug: "dev-box",
      localPiWebUrl: "http://127.0.0.1:8504",
      frpcPath: "/opt/frpc",
    });

    expect(application.loginInput).toEqual({
      controlApiBaseUrl: "https://control.example.test",
      machineName: "Dev Box",
      machineSlug: "dev-box",
      localPiWebUrl: "http://127.0.0.1:8504",
      frpcPath: "/opt/frpc",
    });
    expect(response.operation.status).toBe("running");
    expect(runner.runCalls.every(({ args }) => args[0] === "status")).toBe(true);

    application.loginObserver?.onDeviceAuthorization?.({
      deviceCode: "private-device-code",
      userCode: "ABCD-EFGH",
      verificationUri: "https://control.example.test/device",
      verificationUriComplete: "https://control.example.test/device?user_code=ABCD-EFGH",
      expiresAt: "2026-07-29T00:10:00.000Z",
      intervalSeconds: 5,
    });
    expect(service.operation(response.operation.id)).toMatchObject({
      userCode: "ABCD-EFGH",
      verificationUriComplete: "https://control.example.test/device?user_code=ABCD-EFGH",
    });
    expect(JSON.stringify(service.operation(response.operation.id))).not.toContain("private-device-code");

    loginDeferred.resolve(loginResult());
    await Promise.resolve();
    await Promise.resolve();

    expect(service.operation(response.operation.id)).toMatchObject({
      status: "succeeded",
      exitCode: 0,
      publicUrl: "https://dev-box.ns.tunnels.pi-web.dev",
    });
  });

  it("persists enabled intent before using the temporary connector runtime", async () => {
    application.loaded = registeredState({ frpcPath: "/opt/frpc" });
    const startDeferred = createDeferred<SafeTunnelCommandRunResult>();
    runner.startDeferred = startDeferred;
    runner.startProcessId = 1234;

    const response = await service.start({ frpcPath: "/advanced/frpc" });

    expect(application.enableCalls).toEqual(["/advanced/frpc"]);
    expect(application.loaded.state.desiredState).toBe("enabled");
    expect(runner.runCalls.find(({ args }) => args[0] === "start")).toEqual({
      command: "/usr/local/bin/pi-web-tunnel",
      args: ["start", "--frpc-path", "/advanced/frpc"],
    });
    expect(response).toMatchObject({ accepted: true, connectorProcessId: 1234 });
    const startOptions = runner.startOptions;
    expect(startOptions?.environment).toEqual({
      [safeTunnelConnectorConfigPathEnvVar]: application.statePath,
    });
    expect(startOptions?.logPath).toBe(join(tempDirectory, "safe-tunnel", "connector.log"));

    startOptions?.onStderr?.("\u001B[31mfrpc failed\u001B[0m\n");
    expect(service.operation(response.operation.id)?.logTail).toContain("frpc failed");
    expect(service.operation(response.operation.id)?.logTail).not.toContain("\u001B");

    startDeferred.resolve(commandResult({ exitCode: 1, stderr: "frpc failed\n" }));
    await Promise.resolve();
    expect(service.operation(response.operation.id)).toMatchObject({
      status: "failed",
      error: "Safe Tunnel start exited with code 1.",
    });
  });

  it("persists disabled intent before delegating the temporary runtime stop", async () => {
    application.loaded = registeredState({ desiredState: "enabled" });
    runner.stopResult = commandResult({ stdout: "Stopped\n" });

    const response = await service.stop();

    expect(application.disableCalls).toBe(1);
    expect(application.loaded.state.desiredState).toBe("disabled");
    expect(runner.runCalls.find(({ args }) => args[0] === "stop")).toEqual({
      command: "/usr/local/bin/pi-web-tunnel",
      args: ["stop"],
    });
    expect(response.command).toEqual({ exitCode: 0, stdout: "Stopped\n", stderr: "" });
  });

  it("truncates temporary runtime logs and applies private file modes", async () => {
    const nodeRunner = createNodeSafeTunnelCommandRunner();
    const logPath = join(tempDirectory, "safe-tunnel", "connector.log");
    await mkdir(dirnameOf(logPath), { recursive: true });
    await writeFile(logPath, "old output\n");

    const result = await nodeRunner.run({
      command: process.execPath,
      args: ["-e", "console.log('stdout'); console.error('stderr');"],
    }, {
      logHeader: "header\n",
      logPath,
      maxOutputCharacters: 24_000,
      timeoutMs: 15_000,
    });

    const contents = await readFileWhen(logPath, (value) => value.includes("stdout") && value.includes("stderr"));
    expect(result).toMatchObject({ exitCode: 0, timedOut: false });
    expect(contents).toContain("header\n");
    expect(contents).not.toContain("old output");
  });
});

class FakeSafeTunnelApplicationService implements SafeTunnelApplicationService {
  disableCalls = 0;
  enableCalls: (string | undefined)[] = [];
  loaded: LoadedSafeTunnelState = { exists: false, state: createDefaultSafeTunnelState() };
  loginInput: SafeTunnelLoginInput | undefined;
  loginObserver: SafeTunnelLoginObserver | undefined;
  loginResult: Promise<SafeTunnelLoginResult> = Promise.resolve(loginResult());
  stateError: Error | undefined;

  constructor(readonly statePath: string) {}

  state(): Promise<LoadedSafeTunnelState> {
    return this.stateError === undefined
      ? Promise.resolve(structuredClone(this.loaded))
      : Promise.reject(this.stateError);
  }

  login(input: SafeTunnelLoginInput, observer?: SafeTunnelLoginObserver): Promise<SafeTunnelLoginResult> {
    this.loginInput = input;
    this.loginObserver = observer;
    return this.loginResult;
  }

  enable(frpcPath?: string): Promise<SafeTunnelPersistedState> {
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
    this.disableCalls += 1;
    this.loaded = { exists: true, state: { ...this.loaded.state, desiredState: "disabled" } };
    return Promise.resolve(this.loaded.state);
  }
}

class FakeCommandRunner implements SafeTunnelCommandRunner {
  readonly runCalls: { readonly args: readonly string[]; readonly command: string }[] = [];
  readonly runOptions: SafeTunnelCommandRunOptions[] = [];
  startDeferred: Deferred<SafeTunnelCommandRunResult> | undefined;
  startOptions: SafeTunnelCommandRunOptions | undefined;
  startProcessId: number | undefined;
  statusJson = "";
  stopResult = commandResult({});

  run(
    invocation: { readonly args: readonly string[]; readonly command: string },
    options: SafeTunnelCommandRunOptions,
  ): Promise<SafeTunnelCommandRunResult> {
    this.runCalls.push(invocation);
    this.runOptions.push(options);
    const kind = invocation.args[0];
    if (kind === "status") return Promise.resolve(commandResult({ stdout: this.statusJson }));
    if (kind === "start") {
      this.startOptions = options;
      if (this.startProcessId !== undefined) options.onProcessId?.(this.startProcessId);
      return this.startDeferred?.promise ?? Promise.resolve(commandResult({}));
    }
    if (kind === "stop") return Promise.resolve(this.stopResult);
    return Promise.resolve(commandResult({}));
  }
}

function registeredState(overrides: Partial<SafeTunnelPersistedState> = {}): LoadedSafeTunnelState {
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
      machine: { id: "machine_123", accountId: "account_123", name: "Dev Box", slug: "dev-box" },
      publicHostname: "dev-box.ns.tunnels.pi-web.dev",
      publicUrl: "https://dev-box.ns.tunnels.pi-web.dev",
      machineToken: "piwt_mtok_v1_private",
    },
  };
}

function missingMachineCredentials(): never {
  throw new Error("Registered fixture is missing machine credentials");
}

function connectorStatusJson(
  statePath: string,
  options: { readonly runtime?: Record<string, unknown> } = {},
): string {
  const directory = dirnameOf(statePath);
  return JSON.stringify({
    statusVersion: 1,
    config: { path: statePath, exists: true, state: "registered" },
    runtime: {
      pidFilePath: join(directory, "connector.pid"),
      frpcConfigPath: join(directory, "frpc.toml"),
      frpcConfigExists: false,
      state: "stopped",
      ...options.runtime,
    },
    log: {
      path: join(directory, "connector.log"),
      exists: false,
      tailMaxCharacters: 12_000,
    },
  });
}

function commandResult(overrides: Partial<SafeTunnelCommandRunResult>): SafeTunnelCommandRunResult {
  return { exitCode: 0, stdout: "", stderr: "", timedOut: false, ...overrides };
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

function dirnameOf(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "." : path.slice(0, separator);
}

async function readFileWhen(path: string, predicate: (contents: string) => boolean): Promise<string> {
  let contents = "";
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (existsSync(path)) {
      contents = readFileSync(path, "utf8");
      if (predicate(contents)) return contents;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return contents;
}
