import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const tempDirectories: string[] = [];

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
