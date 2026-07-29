import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SafeTunnelDisableResponse,
  SafeTunnelEnableRequest,
  SafeTunnelEnableResponse,
  SafeTunnelOperationResponse,
  SafeTunnelStatusResponse,
} from "../../shared/apiTypes.js";
import {
  SafeTunnelBridgeError,
  type SafeTunnelBridgeService,
} from "./safeTunnelBridgeService.js";
import { registerSafeTunnelRoutes } from "./safeTunnelRoutes.js";

let app: FastifyInstance;
let service: FakeSafeTunnelBridgeService;

beforeEach(async () => {
  app = Fastify({ logger: false });
  service = new FakeSafeTunnelBridgeService();
  registerSafeTunnelRoutes(app, service);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("registerSafeTunnelRoutes", () => {
  it("starts reconciliation before serving redacted status", async () => {
    const response = await app.inject({ method: "GET", url: "/api/safe-tunnel/status" });

    expect(service.startup).toHaveBeenCalledOnce();
    expect(response.statusCode).toBe(200);
    expect(response.json<SafeTunnelStatusResponse>()).toEqual(service.statusResponse);
  });

  it("starts the normal no-input Enable Safe Tunnel flow", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/safe-tunnel/enable",
      payload: {},
    });

    expect(response.statusCode).toBe(202);
    expect(response.json<SafeTunnelEnableResponse>()).toEqual(service.enableResponse);
    expect(service.enable).toHaveBeenCalledWith({});
  });

  it("accepts only explicit advanced development/self-hosting overrides", async () => {
    const payload = {
      advanced: {
        controlApiUrl: " http://127.0.0.1:8787 ",
        machineName: " Dev Box ",
        machineSlug: " dev-box ",
        localPiWebUrl: " http://127.0.0.1:8504 ",
        frpcPath: " /opt/frpc ",
      },
    };

    const response = await app.inject({
      method: "POST",
      url: "/api/safe-tunnel/enable",
      payload,
    });

    expect(response.statusCode).toBe(202);
    expect(service.enable).toHaveBeenCalledWith({
      advanced: {
        controlApiUrl: "http://127.0.0.1:8787",
        machineName: "Dev Box",
        machineSlug: "dev-box",
        localPiWebUrl: "http://127.0.0.1:8504",
        frpcPath: "/opt/frpc",
      },
    });
  });

  it("rejects old manual normal-flow fields and malformed overrides", async () => {
    const legacy = await app.inject({
      method: "POST",
      url: "/api/safe-tunnel/enable",
      payload: { controlApiUrl: "https://control.example.test" },
    });
    const malformed = await app.inject({
      method: "POST",
      url: "/api/safe-tunnel/enable",
      payload: { advanced: { machineSlug: "" } },
    });

    expect(legacy.statusCode).toBe(400);
    expect(legacy.json()).toEqual({
      error: "Safe Tunnel enable request contains unsupported field: controlApiUrl",
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toEqual({
      error: "Safe Tunnel advanced machineSlug must be a non-empty string",
    });
    expect(service.enable).not.toHaveBeenCalled();
  });

  it("disables the entire flow and looks up tracked progress", async () => {
    const disabled = await app.inject({ method: "POST", url: "/api/safe-tunnel/disable" });
    const operation = await app.inject({
      method: "GET",
      url: "/api/safe-tunnel/operations/op_1",
    });
    const missing = await app.inject({
      method: "GET",
      url: "/api/safe-tunnel/operations/missing",
    });

    expect(disabled.statusCode).toBe(200);
    expect(disabled.json<SafeTunnelDisableResponse>()).toEqual(service.disableResponse);
    expect(service.disable).toHaveBeenCalledOnce();
    expect(operation.json<SafeTunnelOperationResponse>()).toEqual(service.operationResponse);
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "Safe Tunnel operation not found" });
  });

  it("does not expose the old separate login/start/stop routes", async () => {
    for (const url of [
      "/api/safe-tunnel/login",
      "/api/safe-tunnel/start",
      "/api/safe-tunnel/stop",
    ]) {
      const response = await app.inject({ method: "POST", url, payload: {} });
      expect(response.statusCode).toBe(404);
    }
  });

  it("shuts down direct supervision when Fastify closes", async () => {
    await app.close();

    expect(service.shutdown).toHaveBeenCalledOnce();
  });

  it("maps bridge errors to their HTTP status", async () => {
    service.enable.mockRejectedValueOnce(new SafeTunnelBridgeError("Already enabled", 409));

    const response = await app.inject({
      method: "POST",
      url: "/api/safe-tunnel/enable",
      payload: {},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "Already enabled" });
  });
});

class FakeSafeTunnelBridgeService implements SafeTunnelBridgeService {
  readonly operationResponse: SafeTunnelOperationResponse = {
    id: "op_1",
    kind: "enable",
    phase: "awaiting_approval",
    startedAt: "2026-07-03T00:00:00.000Z",
    status: "running",
    stdout: "",
    stderr: "",
    userCode: "ABCD-EFGH",
    verificationUriComplete: "https://api.tunnels.pi-web.dev/device?user_code=ABCD-EFGH",
  };

  readonly statusResponse: SafeTunnelStatusResponse = {
    connector: { command: "PI WEB built-in frpc supervisor", state: "available" },
    config: { exists: false, path: "/tmp/pi-web/config.json", state: "missing" },
    desiredState: "disabled",
    runtime: { state: "stopped" },
  };

  readonly enableResponse: SafeTunnelEnableResponse = {
    accepted: true,
    operation: this.operationResponse,
    status: { ...this.statusResponse, activeOperation: this.operationResponse },
  };

  readonly disableResponse: SafeTunnelDisableResponse = {
    status: this.statusResponse,
  };

  readonly disable = vi.fn<() => Promise<SafeTunnelDisableResponse>>(() => Promise.resolve(this.disableResponse));
  readonly enable = vi.fn<(request: SafeTunnelEnableRequest) => Promise<SafeTunnelEnableResponse>>(() => Promise.resolve(this.enableResponse));
  readonly operation = vi.fn<(operationId: string) => SafeTunnelOperationResponse | undefined>((operationId) => (operationId === "op_1" ? this.operationResponse : undefined));
  readonly shutdown = vi.fn<() => Promise<void>>(() => Promise.resolve());
  readonly startup = vi.fn<() => Promise<void>>(() => Promise.resolve());
  readonly status = vi.fn<() => Promise<SafeTunnelStatusResponse>>(() => Promise.resolve(this.statusResponse));
}
