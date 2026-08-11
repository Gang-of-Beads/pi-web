import { describe, expect, it } from "vitest";
import type {
  SafeTunnelManagedFrpc,
  SafeTunnelManagedFrpcProvider,
} from "./safeTunnelFrpcManager.js";
import type {
  SafeTunnelFrpcProcessHandle,
  SafeTunnelFrpcProcessLauncher,
  SafeTunnelFrpcProcessObserver,
  SafeTunnelFrpcProcessRequest,
} from "./safeTunnelFrpcProcess.js";
import type {
  SafeTunnelFrpcRuntimeFileStatus,
  SafeTunnelFrpcRuntimeFiles,
} from "./safeTunnelFrpcRuntimeFiles.js";
import {
  SafeTunnelFrpcSupervisor,
  SafeTunnelFrpcSupervisorError,
  type SafeTunnelFrpcConfigProvider,
  type SafeTunnelScheduledTask,
  type SafeTunnelSupervisorClock,
} from "./safeTunnelFrpcSupervisor.js";
import type { SafeTunnelPreparedTunnelConfig } from "./safeTunnelService.js";

const frpcToken = "private-relay-token-0123456789abcdef";
const trustedCaPath = "/private/safe-tunnel/frps-roots.pem";

const policy = {
  initialRestartDelayMs: 10,
  killGracePeriodMs: 5,
  maximumRestartDelayMs: 40,
  stableRunDurationMs: 100,
  stopGracePeriodMs: 5,
} as const;

describe("SafeTunnelFrpcSupervisor", () => {
  it("prepares managed frpc, writes config, and owns the exact launched child", async () => {
    const fixture = createFixture();
    fixture.managedFrpc.result = {
      ...fixture.managedFrpc.result,
      architecture: "x64",
    };

    const result = await fixture.supervisor.start({});

    expect(fixture.configProvider.calls).toBe(1);
    expect(fixture.managedFrpc.calls).toBe(1);
    expect(fixture.files.configWrites).toEqual([preparedConfig().frpcConfigToml]);
    expect(fixture.files.configWrites[0]).toContain(
      `trustedCaFile = ${JSON.stringify(trustedCaPath)}`,
    );
    expect(fixture.files.configWrites[0]).toContain('serverName = "relay.example.test"');
    expect(fixture.launcher.requests).toEqual([{
      configPath: fixture.files.configPath,
      frpcPath: fixture.managedFrpc.result.path,
    }]);
    expect(result).toMatchObject({
      credentialRedactionValues: [frpcToken],
      pid: 4000,
      publicUrl: "https://dev-box.ns.tunnels.pi-web.dev",
    });
    expect(result.output).toContain("verified PI WEB-managed frpc v0.69.1 for linux-x64");
    expect(result.output).not.toContain("linux-arm64");
    expect(result.output).not.toContain(fixture.managedFrpc.result.path);
    expect(result.output).not.toContain(frpcToken);

    fixture.launcher.processes[0]?.stdout(`frpc ready: ${frpcToken.slice(0, 17)}`);
    fixture.launcher.processes[0]?.stdout(`${frpcToken.slice(17)}\n${"x".repeat(300)}`);
    const status = await fixture.supervisor.status();
    expect(status).toMatchObject({
      state: "running",
      pid: 4000,
      frpcConfigExists: true,
    });
    expect(status.logTail).toContain("frpc ready: █");
    expect(status.logTail).not.toContain(frpcToken);
  });

  it("redacts credentials split across chunks, streams, and terminal controls", async () => {
    const fixture = createFixture();
    const credential = `aB3!${"q".repeat(28)}`;
    fixture.configProvider.result = Promise.resolve(preparedConfig(credential));

    await fixture.supervisor.start({});
    const child = fixture.launcher.processes[0];
    if (child === undefined) throw new Error("missing fake child");

    child.stdout("useful frpc diagnostic: a");
    child.stderr("\u001B[");
    child.stdout("31mB");
    child.stderr("\u001B[0m3");
    child.stdout(`!${"q".repeat(28)} failed safely\n${"x".repeat(300)}`);

    const status = await fixture.supervisor.status();

    expect(fixture.files.log).toContain("useful frpc diagnostic:");
    expect(fixture.files.log).toContain("█");
    expect(fixture.files.log).not.toContain(credential);
    expect(fixture.files.log).not.toContain("\u001B");
    expect(status.logTail).not.toContain(credential);
    expect(fixture.files.logRedactionValues).toContain(credential);
  });

  it("redacts mixed percent and JSON aliases split across child chunks and streams", async () => {
    const fixture = createFixture();
    const credential = `tok+/=${"A".repeat(26)}`;
    fixture.configProvider.result = Promise.resolve(preparedConfig(credential));
    await fixture.supervisor.start({});
    const child = fixture.launcher.processes[0];
    if (child === undefined) throw new Error("missing fake child");

    const aliases = [
      `%74ok%2b%2F%3d${"A".repeat(26)}`,
      `\\u0074\\u006F\\u006b\\u002B\\/\\u003d${"A".repeat(26)}`,
    ];
    let chunkIndex = 0;
    for (const alias of aliases) {
      for (const character of alias) {
        if (chunkIndex % 2 === 0) child.stdout(character);
        else child.stderr(character);
        chunkIndex += 1;
      }
      child.stdout(" safely withheld ");
    }
    child.stderr("x".repeat(300));

    const status = await fixture.supervisor.status();

    for (const alias of aliases) {
      expect(fixture.files.log).not.toContain(alias);
      expect(status.logTail).not.toContain(alias);
    }
    expect(fixture.files.log).toContain("█");
  });

  it("rejects frpc authentication material reused as a public hostname", async () => {
    const fixture = createFixture();
    const credential = "frpsecret0123456789abcdef0123456789";
    fixture.configProvider.result = Promise.resolve({
      ...preparedConfig(credential),
      publicHostname: `${credential}.example.test`,
      publicUrl: `https://${credential}.example.test`,
    });

    await expect(fixture.supervisor.start({})).rejects.toEqual(
      new SafeTunnelFrpcSupervisorError("tunnel_config_failed"),
    );

    expect(fixture.managedFrpc.calls).toBe(0);
    expect(fixture.files.configWrites).toEqual([]);
    expect(fixture.launcher.processes).toEqual([]);
  });

  it("omits structured runtime paths contaminated by an frpc credential", async () => {
    const credential = "private-frpc-credential-0123456789";
    const fixture = createFixture(new FakeRuntimeFiles(
      `/private/${credential}/frpc.toml`,
      `/private/${credential}/frpc.log`,
    ));
    fixture.configProvider.result = Promise.resolve(preparedConfig(credential));

    await fixture.supervisor.start({});
    const status = await fixture.supervisor.status();

    expect(status.frpcConfigPath).toBeUndefined();
    expect(status.logPath).toBeUndefined();
    expect(JSON.stringify(status)).not.toContain(credential);
  });

  it("redacts accepted credentials from PI WEB-owned diagnostics too", async () => {
    const fixture = createFixture();
    const credential = `Safe${"s".repeat(28)}`;
    fixture.configProvider.result = Promise.resolve(preparedConfig(credential));

    const result = await fixture.supervisor.start({});
    const status = await fixture.supervisor.status();

    expect(result.output).toContain("PI WEB-owned");
    expect(result.output).not.toContain(credential);
    expect(status.logTail).not.toContain(credential);
  });

  it("rejects a weak credential even when a config provider bypasses preparation", async () => {
    const fixture = createFixture();
    fixture.configProvider.result = Promise.resolve(preparedConfig("x".repeat(31)));

    await expect(fixture.supervisor.start({})).rejects.toEqual(
      new SafeTunnelFrpcSupervisorError("tunnel_config_failed"),
    );

    expect(fixture.managedFrpc.calls).toBe(0);
    expect(fixture.files.configWrites).toEqual([]);
    expect(fixture.launcher.processes).toEqual([]);
  });

  it("rejects template actions before launching an advanced executable", async () => {
    const fixture = createFixture();
    const config = preparedConfig();
    fixture.configProvider.result = Promise.resolve({
      ...config,
      frpcConfigToml: config.frpcConfigToml.replace(
        "relay.example.test",
        "{{ .Envs.PI_WEB_SERVICE_CREDENTIAL }}",
      ),
    });

    await expect(fixture.supervisor.start({ advancedFrpcPath: "/opt/private/frpc" }))
      .rejects.toEqual(new SafeTunnelFrpcSupervisorError("tunnel_config_failed"));

    expect(fixture.managedFrpc.calls).toBe(0);
    expect(fixture.files.configWrites).toEqual([]);
    expect(fixture.launcher.processes).toEqual([]);
  });

  it.each([
    ["managed", {}],
    ["advanced", { advancedFrpcPath: "/opt/private/frpc" }],
  ] as const)("rejects a repointed CA path before launching the %s executable", async (
    _label,
    startInput,
  ) => {
    const fixture = createFixture();
    const config = preparedConfig();
    fixture.configProvider.result = Promise.resolve({
      ...config,
      frpcConfigToml: config.frpcConfigToml.replace(
        trustedCaPath,
        "/tmp/provider-ca.pem",
      ),
    });

    await expect(fixture.supervisor.start(startInput))
      .rejects.toEqual(new SafeTunnelFrpcSupervisorError("tunnel_config_failed"));

    expect(fixture.managedFrpc.calls).toBe(0);
    expect(fixture.files.configWrites).toEqual([]);
    expect(fixture.launcher.processes).toEqual([]);
  });

  it("uses an advanced executable override without bypassing PI WEB's relay trust", async () => {
    const fixture = createFixture();

    const result = await fixture.supervisor.start({ advancedFrpcPath: "/opt/private/frpc" });

    expect(fixture.managedFrpc.calls).toBe(0);
    expect(fixture.launcher.requests[0]?.frpcPath).toBe("/opt/private/frpc");
    expect(fixture.files.configWrites[0]).toContain(
      `trustedCaFile = ${JSON.stringify(trustedCaPath)}`,
    );
    expect(fixture.files.configWrites[0]).toContain('serverName = "relay.example.test"');
    expect(result.output).toContain("Using an advanced frpc path override.");
    expect(result.output).not.toContain("/opt/private/frpc");
  });

  it("restarts crashes with capped exponential backoff and no busy loop", async () => {
    const fixture = createFixture();
    await fixture.supervisor.start({});

    fixture.launcher.processes[0]?.exit(1);
    expect(fixture.clock.scheduledDelays.at(-1)).toBe(10);
    fixture.clock.advance(9);
    await flushAsyncWork();
    expect(fixture.launcher.processes).toHaveLength(1);

    fixture.clock.advance(1);
    await waitForProcessCount(fixture.launcher, 2);
    fixture.launcher.processes[1]?.exit(1);
    expect(fixture.clock.scheduledDelays.at(-1)).toBe(20);

    fixture.clock.advance(20);
    await waitForProcessCount(fixture.launcher, 3);
    fixture.launcher.processes[2]?.exit(1);
    expect(fixture.clock.scheduledDelays.at(-1)).toBe(40);

    fixture.clock.advance(40);
    await waitForProcessCount(fixture.launcher, 4);
    fixture.launcher.processes[3]?.exit(1);
    expect(fixture.clock.scheduledDelays.at(-1)).toBe(40);
    expect(fixture.launcher.processes).toHaveLength(4);
    const status = await fixture.supervisor.status();
    expect(status.state).toBe("unknown");
    expect(status.error).toContain("Retrying in 40 ms");
  });

  it("resets backoff only after the same child runs stably", async () => {
    const fixture = createFixture();
    await fixture.supervisor.start({});
    fixture.launcher.processes[0]?.exit(1);
    fixture.clock.advance(10);
    await waitForProcessCount(fixture.launcher, 2);

    fixture.clock.advance(100);
    fixture.launcher.processes[1]?.exit(1);

    expect(fixture.clock.scheduledDelays.at(-1)).toBe(10);
  });

  it("disable cancels restart and stable timers and removes generated config", async () => {
    const fixture = createFixture();
    await fixture.supervisor.start({});
    fixture.launcher.processes[0]?.exit(1);
    expect(fixture.clock.activeTaskCount()).toBe(1);

    const result = await fixture.supervisor.stop();
    fixture.clock.advance(1_000);
    await flushAsyncWork();

    expect(result.stdout).toContain("No running");
    expect(fixture.files.removeCalls).toBe(1);
    expect(fixture.files.configExists).toBe(false);
    expect(fixture.clock.activeTaskCount()).toBe(0);
    expect(fixture.launcher.processes).toHaveLength(1);
  });

  it("stops only its current child handle and detaches every owned listener", async () => {
    const fixture = createFixture();
    await fixture.supervisor.start({});
    const child = fixture.launcher.processes[0];
    if (child === undefined) throw new Error("missing fake child");
    child.exitOnTerminate = true;

    const result = await fixture.supervisor.stop();

    expect(child.signals).toEqual(["SIGTERM"]);
    expect(child.disposeCalls).toBe(1);
    expect(result).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "PI WEB stopped its owned Safe Tunnel frpc process.\n",
    });
    expect(fixture.clock.activeTaskCount()).toBe(0);
    await expect(fixture.supervisor.status()).resolves.toMatchObject({ state: "stopped" });
  });

  it("escalates the same child to SIGKILL after a bounded graceful wait", async () => {
    const fixture = createFixture();
    await fixture.supervisor.start({});
    const child = fixture.launcher.processes[0];
    if (child === undefined) throw new Error("missing fake child");

    const shutdown = fixture.supervisor.shutdown();
    expect(child.signals).toEqual(["SIGTERM"]);
    fixture.clock.advance(5);
    await flushAsyncWork();
    expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
    child.exit(null, "SIGKILL");

    await expect(shutdown).resolves.toBeUndefined();
    expect(child.disposeCalls).toBe(1);
    expect(fixture.files.removeCalls).toBe(1);
    expect(fixture.clock.activeTaskCount()).toBe(0);
    await expect(fixture.supervisor.start({})).rejects.toEqual(
      new SafeTunnelFrpcSupervisorError("supervisor_shutdown"),
    );
  });

  it("fails bounded shutdown while retaining ownership until a late close", async () => {
    const fixture = createFixture();
    await fixture.supervisor.start({});
    const child = fixture.launcher.processes[0];
    if (child === undefined) throw new Error("missing fake child");

    const shutdown = fixture.supervisor.shutdown();
    fixture.clock.advance(5);
    await flushAsyncWork();
    fixture.clock.advance(5);

    await expect(shutdown).rejects.toEqual(
      new SafeTunnelFrpcSupervisorError("process_stop_failed"),
    );
    expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(child.disposeCalls).toBe(0);
    expect(fixture.clock.activeTaskCount()).toBe(0);
    expect(fixture.files.removeCalls).toBe(1);
    await expect(fixture.supervisor.status()).resolves.toMatchObject({
      error: "PI WEB could not confirm that its owned Safe Tunnel frpc process stopped.",
      state: "running",
    });

    const retry = fixture.supervisor.shutdown();
    expect(child.signals).toEqual(["SIGTERM", "SIGKILL", "SIGTERM"]);
    fixture.clock.advance(5);
    await flushAsyncWork();
    expect(child.signals).toEqual(["SIGTERM", "SIGKILL", "SIGTERM", "SIGKILL"]);
    child.exit(null, "SIGKILL");

    await expect(retry).resolves.toBeUndefined();
    expect(child.disposeCalls).toBe(1);
    expect(fixture.clock.activeTaskCount()).toBe(0);
    const status = await fixture.supervisor.status();
    expect(status.state).toBe("stopped");
    expect(status.error).toBeUndefined();
  });

  it("retries no-child config cleanup and terminalizes only after success", async () => {
    const fixture = createFixture();
    await fixture.supervisor.start({});
    const child = fixture.launcher.processes[0];
    if (child === undefined) throw new Error("missing fake child");
    child.exitOnTerminate = true;
    fixture.files.removeResults.push(Promise.reject(new Error("remove failed")));

    await expect(fixture.supervisor.shutdown()).rejects.toEqual(
      new SafeTunnelFrpcSupervisorError("config_write_failed"),
    );
    expect(child.signals).toEqual(["SIGTERM"]);
    expect(child.disposeCalls).toBe(1);
    expect(fixture.files.removeCalls).toBe(1);
    expect(fixture.files.configExists).toBe(true);

    const removal = createDeferred<undefined>();
    fixture.files.removeResults.push(removal.promise);
    const retry = fixture.supervisor.shutdown();
    const concurrentRetry = fixture.supervisor.shutdown();
    expect(concurrentRetry).toBe(retry);
    await flushAsyncWork();

    expect(fixture.files.removeCalls).toBe(2);
    expect(child.signals).toEqual(["SIGTERM"]);
    expect(fixture.files.configExists).toBe(true);

    removal.resolve(undefined);
    await expect(Promise.all([retry, concurrentRetry])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(fixture.files.configExists).toBe(false);
    await expect(fixture.supervisor.shutdown()).resolves.toBeUndefined();
    expect(fixture.files.removeCalls).toBe(2);
  });

  it("fails closed on false signal results and blocks replacement until close", async () => {
    const fixture = createFixture();
    await fixture.supervisor.start({});
    const child = fixture.launcher.processes[0];
    if (child === undefined) throw new Error("missing fake child");
    child.terminationResults.set("SIGTERM", false);
    child.terminationResults.set("SIGKILL", false);

    const stopping = fixture.supervisor.stop();

    expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
    fixture.clock.advance(5);
    await expect(stopping).rejects.toEqual(
      new SafeTunnelFrpcSupervisorError("process_stop_failed"),
    );
    expect(child.disposeCalls).toBe(0);
    expect(fixture.clock.activeTaskCount()).toBe(0);
    await expect(fixture.supervisor.start({})).rejects.toEqual(
      new SafeTunnelFrpcSupervisorError("already_running"),
    );
    expect(fixture.launcher.processes).toHaveLength(1);

    child.exit(0);
    await expect(fixture.supervisor.status()).resolves.toMatchObject({ state: "stopped" });
    await expect(fixture.supervisor.start({})).resolves.toMatchObject({ pid: 4001 });
    expect(fixture.launcher.processes).toHaveLength(2);
  });

  it("waits out cancelled preparation without launching a late child", async () => {
    const fixture = createFixture();
    const config = createDeferred<SafeTunnelPreparedTunnelConfig>();
    fixture.configProvider.result = config.promise;

    const starting = fixture.supervisor.start({});
    await flushAsyncWork();
    const stopping = fixture.supervisor.stop();

    expect(fixture.configProvider.signal?.aborted).toBe(true);
    await expect(starting).rejects.toEqual(
      new SafeTunnelFrpcSupervisorError("start_cancelled"),
    );
    await expect(stopping).resolves.toMatchObject({ exitCode: 0 });
    config.resolve(preparedConfig());
    expect(fixture.launcher.processes).toHaveLength(0);
    expect(fixture.managedFrpc.calls).toBe(0);
    expect(fixture.files.removeCalls).toBe(1);
  });

  it("redacts launch failures while keeping enabled supervision on bounded retry", async () => {
    const fixture = createFixture();
    fixture.launcher.launchError = new Error(
      `spawn /private/frpc ENOENT ${frpcToken}`,
    );

    await expect(fixture.supervisor.start({ advancedFrpcPath: "/private/frpc" }))
      .rejects.toEqual(new SafeTunnelFrpcSupervisorError("process_launch_failed"));

    const status = await fixture.supervisor.status();
    expect(status.state).toBe("unknown");
    expect(status.error).toContain("could not launch");
    expect(JSON.stringify(status)).not.toContain("/private/frpc");
    expect(JSON.stringify(status)).not.toContain(frpcToken);
    expect(fixture.clock.scheduledDelays.at(-1)).toBe(10);
  });
});

interface Fixture {
  readonly clock: ManualClock;
  readonly configProvider: FakeConfigProvider;
  readonly files: FakeRuntimeFiles;
  readonly launcher: FakeProcessLauncher;
  readonly managedFrpc: FakeManagedFrpcProvider;
  readonly supervisor: SafeTunnelFrpcSupervisor;
}

function createFixture(files = new FakeRuntimeFiles()): Fixture {
  const clock = new ManualClock();
  const configProvider = new FakeConfigProvider();
  const launcher = new FakeProcessLauncher();
  const managedFrpc = new FakeManagedFrpcProvider();
  return {
    clock,
    configProvider,
    files,
    launcher,
    managedFrpc,
    supervisor: new SafeTunnelFrpcSupervisor({
      clock,
      configProvider,
      files,
      launcher,
      managedFrpc,
      policy,
    }),
  };
}

class FakeConfigProvider implements SafeTunnelFrpcConfigProvider {
  calls = 0;
  result: Promise<SafeTunnelPreparedTunnelConfig> = Promise.resolve(preparedConfig());
  signal: AbortSignal | undefined;

  getTunnelConfig(options: { readonly signal?: AbortSignal } = {}): Promise<SafeTunnelPreparedTunnelConfig> {
    this.calls += 1;
    this.signal = options.signal;
    return this.result;
  }
}

class FakeManagedFrpcProvider implements SafeTunnelManagedFrpcProvider {
  calls = 0;
  result: SafeTunnelManagedFrpc = {
    path: "/private/managed/frpc",
    version: "0.69.1",
    desiredVersion: "0.69.1",
    platform: "linux",
    architecture: "arm64",
    source: "existing",
  };

  ensureManagedFrpc(): Promise<SafeTunnelManagedFrpc> {
    this.calls += 1;
    return Promise.resolve(this.result);
  }
}

class FakeRuntimeFiles implements SafeTunnelFrpcRuntimeFiles {
  readonly configWrites: string[] = [];
  readonly trustedCaPath = trustedCaPath;
  configExists = false;
  log = "";
  readonly logRedactionValues: string[] = [];
  removeCalls = 0;
  readonly removeResults: Promise<void>[] = [];

  constructor(
    readonly configPath = "/private/safe-tunnel/frpc.toml",
    readonly logPath = "/private/safe-tunnel/frpc.log",
  ) {}

  appendLog(chunk: string): void {
    this.log += chunk;
  }

  flushLog(): Promise<void> {
    return Promise.resolve();
  }

  registerLogRedactionValues(values: readonly string[]): void {
    this.logRedactionValues.push(...values);
  }

  removeConfig(): Promise<void> {
    this.removeCalls += 1;
    const result = this.removeResults.shift() ?? Promise.resolve();
    return result.then(() => { this.configExists = false; });
  }

  resetLog(header: string): Promise<void> {
    this.log = header;
    this.logRedactionValues.length = 0;
    return Promise.resolve();
  }

  status(): Promise<SafeTunnelFrpcRuntimeFileStatus> {
    return Promise.resolve({
      configExists: this.configExists,
      logExists: this.log !== "",
      ...(this.log === "" ? {} : { logTail: this.log }),
    });
  }

  writeConfig(contents: string): Promise<void> {
    this.configWrites.push(contents);
    this.configExists = true;
    return Promise.resolve();
  }
}

class FakeProcessLauncher implements SafeTunnelFrpcProcessLauncher {
  launchError: Error | undefined;
  readonly processes: FakeProcessHandle[] = [];
  readonly requests: SafeTunnelFrpcProcessRequest[] = [];

  launch(
    request: SafeTunnelFrpcProcessRequest,
    observer: SafeTunnelFrpcProcessObserver,
  ): SafeTunnelFrpcProcessHandle {
    if (this.launchError !== undefined) throw this.launchError;
    this.requests.push(request);
    const child = new FakeProcessHandle(4000 + this.processes.length, observer);
    this.processes.push(child);
    return child;
  }
}

class FakeProcessHandle implements SafeTunnelFrpcProcessHandle {
  disposeCalls = 0;
  disposed = false;
  exitOnTerminate = false;
  readonly signals: NodeJS.Signals[] = [];
  readonly terminationResults = new Map<NodeJS.Signals, boolean>();

  constructor(
    readonly pid: number,
    private readonly observer: SafeTunnelFrpcProcessObserver,
  ) {}

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeCalls += 1;
  }

  terminate(signal: NodeJS.Signals): boolean {
    this.signals.push(signal);
    const result = this.terminationResults.get(signal) ?? true;
    if (result && this.exitOnTerminate) this.exit(null, signal);
    return result;
  }

  exit(exitCode: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.disposed) return;
    this.observer.onExit({ exitCode, kind: "exited", signal });
  }

  stderr(chunk: string): void {
    if (!this.disposed) this.observer.onStderr?.(chunk);
  }

  stdout(chunk: string): void {
    if (!this.disposed) this.observer.onStdout?.(chunk);
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

function preparedConfig(
  credential = frpcToken,
): SafeTunnelPreparedTunnelConfig {
  return {
    credentialRedactionValues: [credential],
    machineId: "machine_123",
    publicHostname: "dev-box.ns.tunnels.pi-web.dev",
    publicUrl: "https://dev-box.ns.tunnels.pi-web.dev",
    localPiWebUrl: "http://127.0.0.1:8504",
    proxyName: "account-machine",
    frpcConfigToml: [
      'serverAddr = "relay.example.test"',
      "serverPort = 7000",
      'auth.method = "token"',
      `auth.token = ${JSON.stringify(credential)}`,
      "transport.tls.enable = true",
      'transport.tls.serverName = "relay.example.test"',
      `transport.tls.trustedCaFile = ${JSON.stringify(trustedCaPath)}`,
      "",
      "[[proxies]]",
      'name = "account-machine"',
      'type = "http"',
      'localIP = "127.0.0.1"',
      "localPort = 8504",
      'customDomains = ["dev-box.ns.tunnels.pi-web.dev"]',
      "",
    ].join("\n"),
  };
}

async function waitForProcessCount(
  launcher: FakeProcessLauncher,
  count: number,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (launcher.processes.length >= count) return;
    await flushAsyncWork();
  }
  throw new Error(`Expected ${count.toString()} fake processes.`);
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
