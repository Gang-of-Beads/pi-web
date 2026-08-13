import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  NodeSafeTunnelFrpcProcessLauncher,
  type SafeTunnelFrpcProcessExit,
  type SafeTunnelNodeChildProcess,
  type SafeTunnelNodeProcessSpawner,
} from "./safeTunnelFrpcProcess.js";

class FakeNodeChild extends EventEmitter implements SafeTunnelNodeChildProcess {
  readonly signals: NodeJS.Signals[] = [];

  constructor(private readonly pid: number | null = 4242) {
    super();
  }

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

  onError(listener: (error: Error) => void): void {
    this.on("error", listener);
  }

  processId(): number | undefined {
    return this.pid ?? undefined;
  }

  close(exitCode: number | null, signal: NodeJS.Signals | null): void {
    this.emit("close", exitCode, signal);
  }

  fail(error: Error): void {
    this.emit("error", error);
  }
}

describe("NodeSafeTunnelFrpcProcessLauncher", () => {
  it("launches without ambient environment or output and owns the exact returned child", () => {
    const child = new FakeNodeChild();
    const calls: Parameters<SafeTunnelNodeProcessSpawner>[] = [];
    const launcher = new NodeSafeTunnelFrpcProcessLauncher({
      spawnProcess(command, args, options) {
        calls.push([command, args, options]);
        return child;
      },
    });
    const exits: SafeTunnelFrpcProcessExit[] = [];

    const handle = launcher.launch({
      configPath: "/data/pi-web/safe-tunnel/frpc.toml",
      frpcPath: "/data/pi-web/safe-tunnel/frpc/versions/0.69.1/frpc",
    }, {
      onExit: (exit) => { exits.push(exit); },
    });

    expect(calls).toEqual([[
      "/data/pi-web/safe-tunnel/frpc/versions/0.69.1/frpc",
      ["-c", "/data/pi-web/safe-tunnel/frpc.toml"],
      {
        cwd: "/data/pi-web/safe-tunnel",
        detached: false,
        env: {},
        shell: false,
        stdio: ["ignore", "ignore", "ignore"],
        windowsHide: true,
      },
    ]]);
    expect(handle.pid).toBe(4242);
    expect(handle.terminate("SIGTERM")).toBe(true);
    expect(child.signals).toEqual(["SIGTERM"]);

    child.close(null, "SIGTERM");
    child.close(1, null);

    expect(exits).toEqual([{ exitCode: null, kind: "exited", signal: "SIGTERM" }]);
    expect(child.listenerCount("close")).toBe(0);
    expect(child.listenerCount("error")).toBe(0);
  });

  it("reports a pre-spawn error only after the child closes", () => {
    const child = new FakeNodeChild(null);
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

    child.fail(new Error("spawn failed"));
    expect(handle.pid).toBeUndefined();
    expect(exits).toEqual([]);

    child.close(1, null);
    expect(exits).toEqual([{ kind: "error" }]);
    expect(child.listenerCount("close")).toBe(0);
    expect(child.listenerCount("error")).toBe(0);
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
