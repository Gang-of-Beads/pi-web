import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  NodeSafeTunnelFrpcProcessLauncher,
  type SafeTunnelFrpcProcessExit,
  type SafeTunnelNodeChildProcess,
  type SafeTunnelNodeProcessSpawner,
} from "./safeTunnelFrpcProcess.js";

class FakeNodeChild extends EventEmitter implements SafeTunnelNodeChildProcess {
  readonly pid = 4242;
  readonly stderr = new PassThrough();
  readonly stdout = new PassThrough();
  readonly signals: NodeJS.Signals[] = [];

  kill(signal: NodeJS.Signals): boolean {
    this.signals.push(signal);
    return true;
  }

  offClose(
    listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void,
  ): void {
    this.off("close", listener);
  }

  offError(listener: (error: Error) => void): void {
    this.off("error", listener);
  }

  onceClose(
    listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void,
  ): void {
    this.once("close", listener);
  }

  onceError(listener: (error: Error) => void): void {
    this.once("error", listener);
  }

  processId(): number | undefined {
    return this.pid;
  }

  close(exitCode: number | null, signal: NodeJS.Signals | null): void {
    this.emit("close", exitCode, signal);
  }

  fail(error: Error): void {
    this.emit("error", error);
  }
}

describe("NodeSafeTunnelFrpcProcessLauncher", () => {
  it("launches with an explicit config and owns only the exact returned child", () => {
    const child = new FakeNodeChild();
    const calls: Parameters<SafeTunnelNodeProcessSpawner>[] = [];
    const launcher = new NodeSafeTunnelFrpcProcessLauncher({
      spawnProcess(command, args, options) {
        calls.push([command, args, options]);
        return child;
      },
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exits: SafeTunnelFrpcProcessExit[] = [];

    const handle = launcher.launch({
      configPath: "/data/pi-web/safe-tunnel/frpc.toml",
      frpcPath: "/data/pi-web/safe-tunnel/frpc/versions/0.69.1/frpc",
    }, {
      onExit: (exit) => { exits.push(exit); },
      onStderr: (chunk) => { stderr.push(chunk); },
      onStdout: (chunk) => { stdout.push(chunk); },
    });

    expect(calls).toEqual([[
      "/data/pi-web/safe-tunnel/frpc/versions/0.69.1/frpc",
      ["-c", "/data/pi-web/safe-tunnel/frpc.toml"],
      {
        cwd: "/data/pi-web/safe-tunnel",
        detached: false,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    ]]);
    child.stdout.write("started\n");
    child.stderr.write("warning\n");
    expect(stdout).toEqual(["started\n"]);
    expect(stderr).toEqual(["warning\n"]);

    expect(handle.pid).toBe(4242);
    expect(handle.terminate("SIGTERM")).toBe(true);
    expect(child.signals).toEqual(["SIGTERM"]);

    child.close(null, "SIGTERM");
    child.close(1, null);

    expect(exits).toEqual([{ exitCode: null, kind: "exited", signal: "SIGTERM" }]);
    expect(child.listenerCount("close")).toBe(0);
    expect(child.listenerCount("error")).toBe(0);
    expect(child.stdout.listenerCount("data")).toBe(0);
    expect(child.stderr.listenerCount("data")).toBe(0);
  });

  it("reports a spawn error once and cleans up all child listeners", () => {
    const child = new FakeNodeChild();
    const launcher = new NodeSafeTunnelFrpcProcessLauncher({
      spawnProcess: () => child,
    });
    const exits: SafeTunnelFrpcProcessExit[] = [];
    const stdout: string[] = [];
    const handle = launcher.launch({
      configPath: "/tmp/frpc.toml",
      frpcPath: "/opt/frpc",
    }, {
      onExit: (exit) => { exits.push(exit); },
      onStdout: (chunk) => { stdout.push(chunk); },
    });

    child.fail(new Error("private spawn detail"));
    child.close(1, null);
    child.stdout.write("after failure\n");

    expect(exits).toEqual([{ kind: "error" }]);
    expect(stdout).toEqual([]);
    expect(child.listenerCount("close")).toBe(0);
    expect(child.listenerCount("error")).toBe(0);
    expect(child.stdout.listenerCount("data")).toBe(0);
    expect(child.stderr.listenerCount("data")).toBe(0);
    expect(handle.terminate("SIGKILL")).toBe(true);
    expect(child.signals).toEqual(["SIGKILL"]);
  });

  it("detaches its listeners without signaling the child", () => {
    const child = new FakeNodeChild();
    const launcher = new NodeSafeTunnelFrpcProcessLauncher({
      spawnProcess: () => child,
    });
    const exits: SafeTunnelFrpcProcessExit[] = [];
    const handle = launcher.launch({
      configPath: "/tmp/frpc.toml",
      frpcPath: "/opt/frpc",
    }, {
      onExit: (exit) => { exits.push(exit); },
    });

    handle.dispose();
    handle.dispose();
    child.close(0, null);

    expect(exits).toEqual([]);
    expect(child.signals).toEqual([]);
    expect(child.listenerCount("close")).toBe(0);
    expect(child.listenerCount("error")).toBe(0);
    expect(child.stdout.listenerCount("data")).toBe(0);
    expect(child.stderr.listenerCount("data")).toBe(0);
  });

  it.each([
    ["configPath", { configPath: "  ", frpcPath: "/opt/frpc" }],
    ["frpcPath", { configPath: "/tmp/frpc.toml", frpcPath: "" }],
  ] as const)("rejects an empty %s before spawning", (fieldName, request) => {
    let spawnCalls = 0;
    const launcher = new NodeSafeTunnelFrpcProcessLauncher({
      spawnProcess: () => {
        spawnCalls += 1;
        return new FakeNodeChild();
      },
    });

    expect(() => launcher.launch(request, { onExit: () => undefined }))
      .toThrow(`${fieldName} must be a non-empty path.`);
    expect(spawnCalls).toBe(0);
  });

  it.each([
    ["configPath", { configPath: "relative/frpc.toml", frpcPath: "/opt/frpc" }],
    ["frpcPath", { configPath: "/tmp/frpc.toml", frpcPath: "frpc" }],
  ] as const)("rejects a relative %s before spawning", (fieldName, request) => {
    let spawnCalls = 0;
    const launcher = new NodeSafeTunnelFrpcProcessLauncher({
      spawnProcess: () => {
        spawnCalls += 1;
        return new FakeNodeChild();
      },
    });

    expect(() => launcher.launch(request, { onExit: () => undefined }))
      .toThrow(`${fieldName} must be an absolute path.`);
    expect(spawnCalls).toBe(0);
  });
});
