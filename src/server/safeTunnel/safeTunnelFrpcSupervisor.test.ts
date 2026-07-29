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

    const result = await fixture.supervisor.start({});

    expect(fixture.configProvider.calls).toBe(1);
    expect(fixture.managedFrpc.calls).toBe(1);
    expect(fixture.files.configWrites).toEqual([preparedConfig().frpcConfigToml]);
    expect(fixture.launcher.requests).toEqual([{
      configPath: fixture.files.configPath,
      frpcPath: fixture.managedFrpc.result.path,
    }]);
    expect(result).toMatchObject({
      pid: 4000,
      publicUrl: "https://dev-box.ns.tunnels.pi-web.dev",
    });
    expect(result.output).toContain("verified PI WEB-managed frpc v0.69.1 for linux-arm64");
    expect(result.output).not.toContain(fixture.managedFrpc.result.path);
    expect(result.output).not.toContain("private-relay-token");

    fixture.launcher.processes[0]?.stdout("frpc ready: private-relay-");
    fixture.launcher.processes[0]?.stdout(`token\n${"x".repeat(100)}`);
    const status = await fixture.supervisor.status();
    expect(status).toMatchObject({
      state: "running",
      pid: 4000,
      frpcConfigExists: true,
    });
    expect(status.logTail).toContain("frpc ready: [redacted]");
    expect(status.logTail).not.toContain("private-relay-token");
  });

  it("uses an advanced executable override without invoking managed acquisition", async () => {
    const fixture = createFixture();

    const result = await fixture.supervisor.start({ advancedFrpcPath: "/opt/private/frpc" });

    expect(fixture.managedFrpc.calls).toBe(0);
    expect(fixture.launcher.requests[0]?.frpcPath).toBe("/opt/private/frpc");
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

  it("fails bounded shutdown instead of hanging when the child never reports exit", async () => {
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
    expect(child.disposeCalls).toBe(1);
    expect(fixture.clock.activeTaskCount()).toBe(0);
    expect(fixture.files.removeCalls).toBe(1);
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
      "spawn /private/frpc ENOENT private-relay-token",
    );

    await expect(fixture.supervisor.start({ advancedFrpcPath: "/private/frpc" }))
      .rejects.toEqual(new SafeTunnelFrpcSupervisorError("process_launch_failed"));

    const status = await fixture.supervisor.status();
    expect(status.state).toBe("unknown");
    expect(status.error).toContain("could not launch");
    expect(JSON.stringify(status)).not.toContain("/private/frpc");
    expect(JSON.stringify(status)).not.toContain("private-relay-token");
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

function createFixture(): Fixture {
  const clock = new ManualClock();
  const configProvider = new FakeConfigProvider();
  const files = new FakeRuntimeFiles();
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
  readonly configPath = "/private/safe-tunnel/frpc.toml";
  readonly logPath = "/private/safe-tunnel/frpc.log";
  readonly configWrites: string[] = [];
  configExists = false;
  log = "";
  removeCalls = 0;

  appendLog(chunk: string): void {
    this.log += chunk;
  }

  flushLog(): Promise<void> {
    return Promise.resolve();
  }

  removeConfig(): Promise<void> {
    this.removeCalls += 1;
    this.configExists = false;
    return Promise.resolve();
  }

  resetLog(header: string): Promise<void> {
    this.log = header;
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
    if (this.exitOnTerminate) this.exit(null, signal);
    return true;
  }

  exit(exitCode: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.disposed) return;
    this.observer.onExit({ exitCode, kind: "exited", signal });
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

function preparedConfig(): SafeTunnelPreparedTunnelConfig {
  return {
    machineId: "machine_123",
    publicHostname: "dev-box.ns.tunnels.pi-web.dev",
    publicUrl: "https://dev-box.ns.tunnels.pi-web.dev",
    localPiWebUrl: "http://127.0.0.1:8504",
    proxyName: "account-machine",
    frpcConfigToml: [
      'serverAddr = "relay.example.test"',
      'auth.token = "private-relay-token"',
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
