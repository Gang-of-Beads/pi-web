import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  MachineRuntime,
  PiWebRuntimeResponse,
  SafeTunnelDisableResponse,
  SafeTunnelEnableResponse,
  SafeTunnelStatusResponse,
} from "../shared/apiTypes.js";
import { buildApp } from "./app.js";
import type { SafeTunnelBridgeService } from "./safeTunnel/safeTunnelBridgeService.js";
import type { SessionProxyDaemon } from "./sessiond/sessionProxyRoutes.js";
import {
  runWebProcess,
  WEB_PROCESS_SHUTDOWN_SIGNALS,
  type WebProcessShutdownSignal,
  type WebProcessSignalListener,
  type WebProcessSignalSource,
} from "./webProcessLifecycle.js";

const tempDirectories: string[] = [];
const LONG_SHUTDOWN_RETRY_INTERVAL_MS = 60_000;

const safeTunnelStatus: SafeTunnelStatusResponse = {
  config: { exists: false, path: "/tmp/config.json", state: "missing" },
  desiredState: "disabled",
  runtime: { state: "stopped" },
};

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((path) => (
    rm(path, { recursive: true, force: true })
  )));
});

describe("Safe Tunnel app composition", () => {
  it("keeps disabled API probes and runtime capability signals generic", async () => {
    const clientDist = await createClientDist();
    const app = await buildApp({
      clientDist,
      logger: false,
      sessionDaemon: fakeSessionDaemon(),
    });

    try {
      const statusProbe = await app.inject({
        method: "GET",
        url: "/api/safe-tunnel/status",
      });
      const unknownProbe = await app.inject({
        method: "POST",
        url: "/api/safe-tunnel/not-a-route",
      });
      const runtimeResponse = await app.inject({
        method: "GET",
        url: "/api/pi-web/runtime",
      });
      const localRuntimeResponse = await app.inject({
        method: "GET",
        url: "/api/machines/local/runtime?refresh=1",
      });
      const deepLink = await app.inject({
        method: "GET",
        url: "/settings/safe-tunnel",
      });

      expect(statusProbe.statusCode).toBe(404);
      expect(statusProbe.headers["content-type"]).toContain("application/json");
      expect(statusProbe.json()).toEqual({
        message: "Route GET:/api/safe-tunnel/status not found",
        error: "Not Found",
        statusCode: 404,
      });
      expect(unknownProbe.statusCode).toBe(404);
      expect(unknownProbe.json()).toEqual({
        message: "Route POST:/api/safe-tunnel/not-a-route not found",
        error: "Not Found",
        statusCode: 404,
      });

      const runtime = runtimeResponse.json<PiWebRuntimeResponse>();
      const localRuntime = localRuntimeResponse.json<MachineRuntime>();
      expect(runtime.components.web.capabilities).not.toContain("safeTunnel");
      expect(runtime.capabilities).not.toContain("safeTunnel");
      expect(localRuntime.components?.web.capabilities).not.toContain("safeTunnel");
      expect(localRuntime.capabilities).not.toContain("safeTunnel");
      expect(deepLink.statusCode).toBe(200);
      expect(deepLink.body).toBe("<html>PI WEB</html>");
    } finally {
      await app.close();
    }
  });

  it("starts, routes, advertises, and closes one injected enabled bridge", async () => {
    const fixture = fakeBridge();
    const app = await buildApp({
      clientDist: false,
      logger: false,
      safeTunnel: fixture.bridge,
      sessionDaemon: fakeSessionDaemon(),
    });

    try {
      expect(fixture.startup).not.toHaveBeenCalled();
      await app.ready();
      await app.ready();
      expect(fixture.startup).toHaveBeenCalledOnce();

      const statusResponse = await app.inject({
        method: "GET",
        url: "/api/safe-tunnel/status",
      });
      const runtimeResponse = await app.inject({
        method: "GET",
        url: "/api/pi-web/runtime",
      });
      const localRuntimeResponse = await app.inject({
        method: "GET",
        url: "/api/machines/local/runtime?refresh=1",
      });

      expect(statusResponse.statusCode).toBe(200);
      expect(statusResponse.json()).toEqual(safeTunnelStatus);
      expect(fixture.status).toHaveBeenCalledOnce();

      const runtime = runtimeResponse.json<PiWebRuntimeResponse>();
      const localRuntime = localRuntimeResponse.json<MachineRuntime>();
      expect(runtime.components.web.capabilities).toEqual([
        "plugins.lifecycle",
        "safeTunnel",
      ]);
      expect(runtime.capabilities).toEqual([
        "plugins.lifecycle",
        "safeTunnel",
      ]);
      expect(localRuntime.components?.web.capabilities).toEqual([
        "plugins.lifecycle",
        "safeTunnel",
      ]);
      expect(localRuntime.capabilities).toEqual([
        "plugins.lifecycle",
        "safeTunnel",
      ]);
    } finally {
      await app.close();
    }

    expect(fixture.shutdown).toHaveBeenCalledOnce();
  });
});

describe("web-process lifecycle", () => {
  it.each(WEB_PROCESS_SHUTDOWN_SIGNALS)(
    "closes an enabled Safe Tunnel bridge once on %s",
    async (signal) => {
      const fixture = fakeBridge();
      const signalSource = new FakeWebProcessSignalSource();
      const app = await buildApp({
        clientDist: false,
        logger: false,
        safeTunnel: fixture.bridge,
        sessionDaemon: fakeSessionDaemon(),
      });

      try {
        await runWebProcess(app, { port: 0 }, {
          listen: readyWithoutListening,
          retryShutdown: () => fixture.bridge.shutdown(),
          signalSource,
        });
        expect(fixture.startup).toHaveBeenCalledOnce();

        await signalSource.emit(signal);
        await signalSource.emit(signal);

        expect(fixture.shutdown).toHaveBeenCalledOnce();
        expect(signalSource.listenerCount("SIGINT")).toBe(0);
        expect(signalSource.listenerCount("SIGTERM")).toBe(0);
      } finally {
        await app.close();
      }

      expect(fixture.shutdown).toHaveBeenCalledOnce();
    },
  );

  it("coalesces later signals while retrying a retained enabled bridge", async () => {
    const fixture = fakeBridge();
    const signalSource = new FakeWebProcessSignalSource();
    const stopFailure = new Error("owned child stop was not confirmed");
    const retryShutdown = createDeferred();
    fixture.shutdown
      .mockRejectedValueOnce(stopFailure)
      .mockImplementationOnce(() => retryShutdown.promise);
    const app = await buildApp({
      clientDist: false,
      logger: false,
      safeTunnel: fixture.bridge,
      sessionDaemon: fakeSessionDaemon(),
    });
    const close = vi.fn((closingApp: FastifyInstance) => closingApp.close());
    const logError = vi.spyOn(app.log, "error");

    try {
      await runWebProcess(app, { port: 0 }, {
        close,
        listen: readyWithoutListening,
        retryShutdown: () => fixture.bridge.shutdown(),
        shutdownRetryIntervalMs: LONG_SHUTDOWN_RETRY_INTERVAL_MS,
        signalSource,
      });

      await signalSource.emit("SIGTERM");

      expect(close).toHaveBeenCalledOnce();
      expect(fixture.shutdown).toHaveBeenCalledOnce();
      expect(logError).toHaveBeenCalledWith(
        { err: stopFailure, signal: "SIGTERM" },
        "failed to close web server after shutdown signal",
      );
      expect(signalSource.listenerCount("SIGINT")).toBe(1);
      expect(signalSource.listenerCount("SIGTERM")).toBe(1);

      const retryRequests = [
        signalSource.emit("SIGINT"),
        signalSource.emit("SIGTERM"),
      ];
      await Promise.resolve();

      expect(close).toHaveBeenCalledOnce();
      expect(fixture.shutdown).toHaveBeenCalledTimes(2);
      expect(signalSource.listenerCount("SIGINT")).toBe(1);
      expect(signalSource.listenerCount("SIGTERM")).toBe(1);

      retryShutdown.resolve();
      await Promise.all(retryRequests);
      expect(signalSource.listenerCount("SIGINT")).toBe(0);
      expect(signalSource.listenerCount("SIGTERM")).toBe(0);
    } finally {
      retryShutdown.resolve();
      await signalSource.emit("SIGINT");
      await app.close().catch(() => undefined);
    }
  });

  it("retries incomplete signal cleanup on a referenced schedule", async () => {
    const fixture = fakeBridge();
    const signalSource = new FakeWebProcessSignalSource();
    fixture.shutdown
      .mockRejectedValueOnce(new Error("owned child stop was not confirmed"))
      .mockResolvedValueOnce(undefined);
    const app = await buildApp({
      clientDist: false,
      logger: false,
      safeTunnel: fixture.bridge,
      sessionDaemon: fakeSessionDaemon(),
    });

    try {
      await runWebProcess(app, { port: 0 }, {
        listen: readyWithoutListening,
        retryShutdown: () => fixture.bridge.shutdown(),
        shutdownRetryIntervalMs: 10,
        signalSource,
      });

      await signalSource.emit("SIGTERM");
      expect(fixture.shutdown).toHaveBeenCalledOnce();
      expect(signalSource.listenerCount("SIGINT")).toBe(1);
      expect(signalSource.listenerCount("SIGTERM")).toBe(1);

      await vi.waitFor(() => {
        expect(fixture.shutdown).toHaveBeenCalledTimes(2);
        expect(signalSource.listenerCount("SIGINT")).toBe(0);
        expect(signalSource.listenerCount("SIGTERM")).toBe(0);
      });
    } finally {
      await signalSource.emit("SIGINT");
      await app.close().catch(() => undefined);
    }
  });

  it("removes both process listeners when the app is closed externally", async () => {
    const app = Fastify({ logger: false });
    const signalSource = new FakeWebProcessSignalSource();

    try {
      await runWebProcess(app, { port: 0 }, {
        listen: readyWithoutListening,
        signalSource,
      });
      expect(signalSource.listenerCount("SIGINT")).toBe(1);
      expect(signalSource.listenerCount("SIGTERM")).toBe(1);

      await app.close();

      expect(signalSource.listenerCount("SIGINT")).toBe(0);
      expect(signalSource.listenerCount("SIGTERM")).toBe(0);
    } finally {
      await app.close();
    }
  });

  it("coalesces concurrent shutdown signals into one close operation", async () => {
    const app = Fastify({ logger: false });
    const signalSource = new FakeWebProcessSignalSource();
    const closeStarted = createDeferred();
    const releaseClose = createDeferred();
    const close = vi.fn((closingApp: FastifyInstance) => closingApp.close());
    let shutdownRequests: Promise<void>[] = [];
    app.addHook("onClose", async () => {
      closeStarted.resolve();
      await releaseClose.promise;
    });

    try {
      await runWebProcess(app, { port: 0 }, {
        close,
        listen: readyWithoutListening,
        signalSource,
      });

      shutdownRequests = [signalSource.emit("SIGINT")];
      await closeStarted.promise;
      expect(close).toHaveBeenCalledOnce();
      expect(signalSource.listenerCount("SIGINT")).toBe(1);
      expect(signalSource.listenerCount("SIGTERM")).toBe(1);

      shutdownRequests.push(signalSource.emit("SIGTERM"));
      expect(close).toHaveBeenCalledOnce();
      releaseClose.resolve();
      await Promise.all(shutdownRequests);

      expect(close).toHaveBeenCalledOnce();
      expect(signalSource.listenerCount("SIGINT")).toBe(0);
      expect(signalSource.listenerCount("SIGTERM")).toBe(0);
    } finally {
      releaseClose.resolve();
      await Promise.allSettled(shutdownRequests);
      await app.close();
    }
  });

  it("closes a ready app before surfacing its original listen failure", async () => {
    const app = Fastify({ logger: false });
    const signalSource = new FakeWebProcessSignalSource();
    const startup = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const shutdown = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const close = vi.fn((closingApp: FastifyInstance) => closingApp.close());
    const listenFailure = new Error("address already in use");
    app.addHook("onReady", startup);
    app.addHook("onClose", shutdown);

    try {
      await expect(runWebProcess(app, { port: 8504 }, {
        close,
        signalSource,
        listen: async (readyApp) => {
          await readyApp.ready();
          throw listenFailure;
        },
      })).rejects.toBe(listenFailure);

      expect(startup).toHaveBeenCalledOnce();
      expect(shutdown).toHaveBeenCalledOnce();
      expect(close).toHaveBeenCalledOnce();
      expect(signalSource.listenerCount("SIGINT")).toBe(0);
      expect(signalSource.listenerCount("SIGTERM")).toBe(0);
    } finally {
      await app.close();
    }
  });

  it("retains signal ownership until repeated listen-failure cleanup succeeds", async () => {
    const fixture = fakeBridge();
    const signalSource = new FakeWebProcessSignalSource();
    const listenFailure = new Error("address already in use");
    const retryFailure = new Error("owned child still did not stop");
    fixture.shutdown
      .mockRejectedValueOnce(new Error("owned child stop was not confirmed"))
      .mockRejectedValueOnce(retryFailure)
      .mockResolvedValueOnce(undefined);
    const app = await buildApp({
      clientDist: false,
      logger: false,
      safeTunnel: fixture.bridge,
      sessionDaemon: fakeSessionDaemon(),
    });
    const close = vi.fn((closingApp: FastifyInstance) => closingApp.close());
    const logError = vi.spyOn(app.log, "error");

    try {
      let lifecycleSettled = false;
      const lifecycleResult = runWebProcess(app, { port: 8504 }, {
        close,
        retryShutdown: () => fixture.bridge.shutdown(),
        shutdownRetryIntervalMs: LONG_SHUTDOWN_RETRY_INTERVAL_MS,
        signalSource,
        listen: async (readyApp) => {
          await readyApp.ready();
          throw listenFailure;
        },
      }).then(
        () => {
          lifecycleSettled = true;
          return undefined;
        },
        (error: unknown) => {
          lifecycleSettled = true;
          return error;
        },
      );

      await vi.waitFor(() => {
        expect(fixture.shutdown).toHaveBeenCalledTimes(2);
        expect(logError).toHaveBeenCalledWith(
          { err: retryFailure },
          "web server listen failed and shutdown was incomplete",
        );
      });
      expect(fixture.startup).toHaveBeenCalledOnce();
      expect(close).toHaveBeenCalledOnce();
      expect(lifecycleSettled).toBe(false);
      expect(signalSource.listenerCount("SIGINT")).toBe(1);
      expect(signalSource.listenerCount("SIGTERM")).toBe(1);

      await Promise.all([
        signalSource.emit("SIGINT"),
        signalSource.emit("SIGTERM"),
      ]);

      expect(await lifecycleResult).toBe(listenFailure);
      expect(fixture.shutdown).toHaveBeenCalledTimes(3);
      expect(signalSource.listenerCount("SIGINT")).toBe(0);
      expect(signalSource.listenerCount("SIGTERM")).toBe(0);
    } finally {
      await signalSource.emit("SIGINT");
      await app.close().catch(() => undefined);
    }
  });

  it("logs cleanup failure without masking the original listen failure", async () => {
    const app = Fastify({ logger: false });
    const signalSource = new FakeWebProcessSignalSource();
    const listenFailure = new Error("listen failed");
    const cleanupFailure = new Error("shutdown failed");
    const logError = vi.spyOn(app.log, "error");
    app.addHook("onClose", () => Promise.reject(cleanupFailure));

    try {
      await expect(runWebProcess(app, { port: 8504 }, {
        signalSource,
        listen: async (readyApp) => {
          await readyApp.ready();
          throw listenFailure;
        },
      })).rejects.toBe(listenFailure);

      expect(logError).toHaveBeenCalledWith(
        { err: cleanupFailure },
        "web server listen failed and shutdown was incomplete",
      );
      expect(signalSource.listenerCount("SIGINT")).toBe(0);
      expect(signalSource.listenerCount("SIGTERM")).toBe(0);
    } finally {
      await app.close().catch(() => undefined);
    }
  });

  it("reports a signal-driven close failure after releasing signal ownership", async () => {
    const app = Fastify({ logger: false });
    const signalSource = new FakeWebProcessSignalSource();
    const cleanupFailure = new Error("shutdown failed");
    const logError = vi.spyOn(app.log, "error");
    app.addHook("onClose", () => Promise.reject(cleanupFailure));

    try {
      await runWebProcess(app, { port: 0 }, {
        listen: readyWithoutListening,
        signalSource,
      });

      await signalSource.emit("SIGTERM");

      expect(logError).toHaveBeenCalledWith(
        { err: cleanupFailure, signal: "SIGTERM" },
        "failed to close web server after shutdown signal",
      );
      expect(signalSource.listenerCount("SIGINT")).toBe(0);
      expect(signalSource.listenerCount("SIGTERM")).toBe(0);
    } finally {
      await app.close().catch(() => undefined);
    }
  });
});

async function createClientDist(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-web-safe-tunnel-app-"));
  tempDirectories.push(directory);
  await writeFile(join(directory, "index.html"), "<html>PI WEB</html>", "utf8");
  return directory;
}

function fakeSessionDaemon(): SessionProxyDaemon {
  return {
    request: vi.fn(() => Promise.resolve({
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        component: "sessiond",
        label: "Session daemon",
        available: true,
        capabilities: [],
      }),
    })),
    connectWebSocket: () => {
      throw new Error("WebSocket not configured for test");
    },
  };
}

async function readyWithoutListening(app: FastifyInstance): Promise<void> {
  await app.ready();
}

class FakeWebProcessSignalSource implements WebProcessSignalSource {
  private readonly listeners = new Map<
    WebProcessShutdownSignal,
    Set<WebProcessSignalListener>
  >();

  subscribe(
    signal: WebProcessShutdownSignal,
    listener: WebProcessSignalListener,
  ): () => void {
    const listeners = this.listeners.get(signal) ?? new Set();
    listeners.add(listener);
    this.listeners.set(signal, listeners);
    return () => { listeners.delete(listener); };
  }

  async emit(signal: WebProcessShutdownSignal): Promise<void> {
    await Promise.all(
      [...(this.listeners.get(signal) ?? [])].map(async (listener) => listener()),
    );
  }

  listenerCount(signal: WebProcessShutdownSignal): number {
    return this.listeners.get(signal)?.size ?? 0;
  }
}

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function fakeBridge() {
  const startup = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const shutdown = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const status = vi.fn<() => Promise<SafeTunnelStatusResponse>>(() => (
    Promise.resolve(safeTunnelStatus)
  ));
  const disableResponse: SafeTunnelDisableResponse = { status: safeTunnelStatus };
  const enableResponse: SafeTunnelEnableResponse = {
    accepted: true,
    operation: {
      id: "op-1",
      kind: "enable",
      phase: "preparing",
      status: "running",
      startedAt: "2026-08-01T00:00:00.000Z",
      stdout: "",
      stderr: "",
    },
    status: safeTunnelStatus,
  };
  const bridge: SafeTunnelBridgeService = {
    disable: vi.fn(() => Promise.resolve(disableResponse)),
    enable: vi.fn(() => Promise.resolve(enableResponse)),
    operation: vi.fn(() => undefined),
    shutdown,
    startup,
    status,
  };
  return { bridge, shutdown, startup, status };
}
