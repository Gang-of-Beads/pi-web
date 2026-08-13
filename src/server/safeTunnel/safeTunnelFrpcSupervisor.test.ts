import { describe, expect, it } from "vitest";
import type { SafeTunnelManagedFrpcProvider } from "./safeTunnelFrpcManager.js";
import type {
  SafeTunnelFrpcProcessExit,
  SafeTunnelFrpcProcessHandle,
  SafeTunnelFrpcProcessLauncher,
  SafeTunnelFrpcProcessObserver,
  SafeTunnelFrpcProcessRequest,
} from "./safeTunnelFrpcProcess.js";
import type { SafeTunnelFrpcRuntimeFiles } from "./safeTunnelFrpcRuntimeFiles.js";
import { applySafeTunnelLocalTarget } from "./safeTunnelService.js";
import {
  SafeTunnelFrpcSupervisor,
  SafeTunnelFrpcSupervisorError,
  type SafeTunnelFrpcConfigProvider,
  type SafeTunnelScheduledTask,
  type SafeTunnelSupervisorClock,
} from "./safeTunnelFrpcSupervisor.js";

const configPath = "/private/safe-tunnel/frpc.toml";
const trustedCaPath = "/private/safe-tunnel/frps-roots.pem";
const managedPath = "/private/safe-tunnel/bin/frpc";
const publicUrl = "https://machine.example.test";
const frpcToken = "0123456789abcdef0123456789abcdef";

describe("SafeTunnelFrpcSupervisor", () => {
  it("writes one constrained config, launches one child, and reports authored status only", async () => {
    const fixture = createFixture();

    const result = await fixture.supervisor.start({});
    fixture.launcher.processes[0]?.stdout(`raw child output ${frpcToken}`);
    fixture.launcher.processes[0]?.stderr("raw child failure");

    expect(result).toEqual({ publicUrl });
    expect(fixture.files.writes).toEqual([fixture.configProvider.config.frpcConfigToml]);
    expect(fixture.launcher.requests).toEqual([{ configPath, frpcPath: managedPath }]);
    expect(await fixture.supervisor.status()).toEqual({ state: "running" });
    expect(JSON.stringify(await fixture.supervisor.status())).not.toContain(frpcToken);
  });

  it("uses an explicit advanced executable without acquiring managed frpc", async () => {
    const fixture = createFixture();

    await fixture.supervisor.start({ advancedFrpcPath: "/opt/frpc" });

    expect(fixture.managed.calls).toBe(0);
    expect(fixture.launcher.requests).toEqual([{ configPath, frpcPath: "/opt/frpc" }]);
  });

  it("restarts after an ordinary unexpected child exit", async () => {
    const fixture = createFixture();
    await fixture.supervisor.start({});

    fixture.launcher.processes[0]?.exit({ exitCode: 1, kind: "exited", signal: null });
    expect(await fixture.supervisor.status()).toMatchObject({
      state: "unknown",
      error: "The owned frpc process exited unexpectedly with code 1. Retrying in 10 ms.",
    });

    fixture.clock.advance(10);
    await settle();

    expect(fixture.launcher.requests).toHaveLength(2);
    expect(await fixture.supervisor.status()).toEqual({ state: "running" });
  });

  it("stops only its exact child and removes generated credentials", async () => {
    const fixture = createFixture();
    await fixture.supervisor.start({});
    const child = fixture.launcher.processes[0];

    await expect(fixture.supervisor.stop()).resolves.toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "PI WEB stopped its owned Safe Tunnel frpc process.\n",
    });

    expect(child?.signals).toEqual(["SIGTERM"]);
    expect(child?.disposed).toBe(true);
    expect(fixture.files.removeCalls).toBe(1);
    expect(await fixture.supervisor.status()).toEqual({ state: "stopped" });
  });

  it("reports one stable category when tunnel preparation fails and schedules retry", async () => {
    const fixture = createFixture();
    fixture.configProvider.error = new Error("raw provider response");

    await expect(fixture.supervisor.start({})).rejects.toMatchObject({
      code: "tunnel_config_failed",
    });
    expect(await fixture.supervisor.status()).toEqual({
      state: "unknown",
      error: "PI WEB could not prepare Safe Tunnel configuration. Retrying in 10 ms.",
    });
  });

  it("shuts down idempotently and rejects later starts", async () => {
    const fixture = createFixture();
    await fixture.supervisor.start({});

    await fixture.supervisor.shutdown();
    await fixture.supervisor.shutdown();

    expect(fixture.files.removeCalls).toBe(1);
    await expect(fixture.supervisor.start({})).rejects.toEqual(
      new SafeTunnelFrpcSupervisorError("supervisor_shutdown"),
    );
  });
});

function createFixture(): {
  readonly clock: ManualClock;
  readonly configProvider: FakeConfigProvider;
  readonly files: FakeRuntimeFiles;
  readonly launcher: FakeLauncher;
  readonly managed: FakeManagedFrpc;
  readonly supervisor: SafeTunnelFrpcSupervisor;
} {
  const clock = new ManualClock();
  const configProvider = new FakeConfigProvider();
  const files = new FakeRuntimeFiles();
  const launcher = new FakeLauncher();
  const managed = new FakeManagedFrpc();
  const supervisor = new SafeTunnelFrpcSupervisor({
    clock,
    configProvider,
    files,
    launcher,
    managedFrpc: managed,
    policy: {
      initialRestartDelayMs: 10,
      killGracePeriodMs: 5,
      maximumRestartDelayMs: 40,
      stableRunDurationMs: 100,
      stopGracePeriodMs: 5,
    },
  });
  return { clock, configProvider, files, launcher, managed, supervisor };
}

class FakeConfigProvider implements SafeTunnelFrpcConfigProvider {
  readonly config = applySafeTunnelLocalTarget({
    machineId: "machine_123",
    publicHostname: "machine.example.test",
    publicUrl,
    localPiWebUrl: "http://127.0.0.1:8504",
    proxyName: "pi-web-machine-123",
    frpcConfigToml: [
      "serverAddr = \"relay.example.test\"",
      "serverPort = 7000",
      "",
      "[auth]",
      "method = \"token\"",
      `token = "${frpcToken}"`,
      "",
      "[transport.tls]",
      "enable = true",
      "",
      "[[proxies]]",
      "name = \"pi-web-machine-123\"",
      "type = \"http\"",
      "localIP = \"127.0.0.1\"",
      "localPort = 8504",
      "customDomains = [\"machine.example.test\"]",
      "",
    ].join("\n"),
  }, "http://127.0.0.1:8504", trustedCaPath);
  error: Error | undefined;

  getTunnelConfig(): Promise<typeof this.config> {
    return this.error === undefined
      ? Promise.resolve(this.config)
      : Promise.reject(this.error);
  }
}

class FakeRuntimeFiles implements SafeTunnelFrpcRuntimeFiles {
  readonly configPath = configPath;
  readonly trustedCaPath = trustedCaPath;
  removeCalls = 0;
  readonly writes: string[] = [];

  removeConfig(): Promise<void> {
    this.removeCalls += 1;
    return Promise.resolve();
  }

  writeConfig(contents: string): Promise<void> {
    this.writes.push(contents);
    return Promise.resolve();
  }
}

class FakeManagedFrpc implements SafeTunnelManagedFrpcProvider {
  calls = 0;

  ensureManagedFrpc() {
    this.calls += 1;
    return Promise.resolve({
      path: managedPath,
      version: "0.61.0",
      desiredVersion: "0.61.0",
      platform: "linux" as const,
      architecture: "x64" as const,
      source: "existing" as const,
    });
  }
}

class FakeLauncher implements SafeTunnelFrpcProcessLauncher {
  readonly processes: FakeProcess[] = [];
  readonly requests: SafeTunnelFrpcProcessRequest[] = [];

  launch(
    request: SafeTunnelFrpcProcessRequest,
    observer: SafeTunnelFrpcProcessObserver,
  ): SafeTunnelFrpcProcessHandle {
    this.requests.push(request);
    const process = new FakeProcess(observer, 4_000 + this.processes.length);
    this.processes.push(process);
    return process;
  }
}

class FakeProcess implements SafeTunnelFrpcProcessHandle {
  disposed = false;
  readonly signals: NodeJS.Signals[] = [];

  constructor(
    private readonly observer: SafeTunnelFrpcProcessObserver,
    readonly pid: number,
  ) {}

  dispose(): void {
    this.disposed = true;
  }

  terminate(signal: NodeJS.Signals): boolean {
    this.signals.push(signal);
    queueMicrotask(() => {
      this.exit({ exitCode: 0, kind: "exited", signal });
    });
    return true;
  }

  exit(exit: SafeTunnelFrpcProcessExit): void {
    this.observer.onExit(exit);
  }

  stderr(value: string): void {
    this.observer.onStderr?.(value);
  }

  stdout(value: string): void {
    this.observer.onStdout?.(value);
  }
}

interface Scheduled {
  readonly callback: () => void;
  readonly dueAt: number;
  cancelled: boolean;
}

class ManualClock implements SafeTunnelSupervisorClock {
  private current = 0;
  private readonly scheduled: Scheduled[] = [];

  now(): Date {
    return new Date(this.current);
  }

  schedule(callback: () => void, delayMs: number): SafeTunnelScheduledTask {
    const task = { callback, dueAt: this.current + delayMs, cancelled: false };
    this.scheduled.push(task);
    return { cancel: () => { task.cancelled = true; } };
  }

  advance(milliseconds: number): void {
    this.current += milliseconds;
    for (const task of this.scheduled) {
      if (!task.cancelled && task.dueAt <= this.current) {
        task.cancelled = true;
        task.callback();
      }
    }
  }
}

async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}
