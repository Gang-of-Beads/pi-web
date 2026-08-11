import { gunzipSync } from "node:zlib";
import fastifyCompress from "@fastify/compress";
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
  SafeTunnelOperationConflictError,
  registerSafeTunnelRoutes,
  type SafeTunnelRouteService,
} from "./safeTunnelRoutes.js";

let app: FastifyInstance;
let service: FakeSafeTunnelRouteService;

beforeEach(async () => {
  app = Fastify({ logger: false });
  await app.register(fastifyCompress, {
    globalCompression: true,
    globalDecompression: false,
    threshold: 1024,
  });
  service = new FakeSafeTunnelRouteService();
  registerSafeTunnelRoutes(app, service);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("registerSafeTunnelRoutes", () => {
  it("remains inert until an explicitly registered route is requested", () => {
    expect(service.status).not.toHaveBeenCalled();
    expect(service.enable).not.toHaveBeenCalled();
    expect(service.disable).not.toHaveBeenCalled();
    expect(service.operation).not.toHaveBeenCalled();
  });

  it("marks status, mutation, operation, and error responses no-store", async () => {
    const responses = await Promise.all([
      app.inject({ method: "GET", url: "/api/safe-tunnel/status" }),
      app.inject({ method: "POST", url: "/api/safe-tunnel/enable", payload: {} }),
      app.inject({ method: "POST", url: "/api/safe-tunnel/disable" }),
      app.inject({ method: "GET", url: "/api/safe-tunnel/operations/op_1" }),
      app.inject({ method: "GET", url: "/api/safe-tunnel/operations/missing" }),
      app.inject({ method: "POST", url: "/api/safe-tunnel/enable", payload: [] }),
    ]);

    for (const response of responses) {
      expect(response.headers["cache-control"]).toBe("no-store");
    }
  });

  it("serves the browser-safe status contract", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/safe-tunnel/status",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<SafeTunnelStatusResponse>()).toEqual(service.statusResponse);
    expect(service.status).toHaveBeenCalledOnce();
  });

  it("starts the normal no-input enable flow", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/safe-tunnel/enable",
      payload: {},
    });

    expect(response.statusCode).toBe(202);
    expect(response.json<SafeTunnelEnableResponse>()).toEqual(service.enableResponse);
    expect(service.enable).toHaveBeenCalledWith({});
  });

  it("returns the complete enable response when HTTP compression is negotiated", async () => {
    const enableResponse: SafeTunnelEnableResponse = {
      ...service.enableResponse,
      operation: {
        ...service.enableResponse.operation,
        stdout: "Safe Tunnel progress\n".repeat(100),
      },
    };
    service.enable.mockResolvedValueOnce(enableResponse);

    const response = await app.inject({
      method: "POST",
      url: "/api/safe-tunnel/enable",
      headers: { "accept-encoding": "gzip" },
      payload: {},
    });

    expect(response.statusCode).toBe(202);
    expect(response.headers["content-encoding"]).toBe("gzip");
    expect(JSON.parse(gunzipSync(response.rawPayload).toString("utf8"))).toEqual(
      enableResponse,
    );
  });

  it("accepts only explicit advanced development and self-hosting overrides", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/safe-tunnel/enable",
      payload: {
        advanced: {
          controlApiUrl: " http://127.0.0.1:8787 ",
          machineName: " Dev Box ",
          machineSlug: " dev-box ",
          localPiWebUrl: " http://127.0.0.1:8504 ",
          frpcPath: " /opt/frpc ",
        },
      },
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

  it("rejects legacy fields, malformed bodies, and malformed overrides", async () => {
    const legacy = await app.inject({
      method: "POST",
      url: "/api/safe-tunnel/enable",
      payload: { controlApiUrl: "https://control.example.test" },
    });
    const malformedBody = await app.inject({
      method: "POST",
      url: "/api/safe-tunnel/enable",
      payload: [],
    });
    const malformedOverride = await app.inject({
      method: "POST",
      url: "/api/safe-tunnel/enable",
      payload: { advanced: { machineSlug: "" } },
    });
    const oversizedOverride = await app.inject({
      method: "POST",
      url: "/api/safe-tunnel/enable",
      payload: { advanced: { machineName: "x".repeat(81) } },
    });

    expect(legacy.statusCode).toBe(400);
    expect(legacy.json()).toEqual({
      error: "Safe Tunnel enable request contains an unsupported field",
    });
    expect(malformedBody.statusCode).toBe(400);
    expect(malformedBody.json()).toEqual({
      error: "Safe Tunnel enable request body must be an object",
    });
    expect(malformedOverride.statusCode).toBe(400);
    expect(malformedOverride.json()).toEqual({
      error: "Safe Tunnel advanced machineSlug must be a non-empty string",
    });
    expect(oversizedOverride.statusCode).toBe(400);
    expect(oversizedOverride.json()).toEqual({
      error: "Safe Tunnel advanced machineName is too long",
    });
    expect(service.enable).not.toHaveBeenCalled();
  });

  it("disables the flow and looks up tracked operation progress", async () => {
    const disabled = await app.inject({
      method: "POST",
      url: "/api/safe-tunnel/disable",
    });
    const operation = await app.inject({
      method: "GET",
      url: "/api/safe-tunnel/operations/op_1",
    });
    const missing = await app.inject({
      method: "GET",
      url: "/api/safe-tunnel/operations/missing",
    });

    expect(disabled.statusCode).toBe(200);
    expect(disabled.json<SafeTunnelDisableResponse>()).toEqual(
      service.disableResponse,
    );
    expect(service.disable).toHaveBeenCalledOnce();
    expect(operation.json<SafeTunnelOperationResponse>()).toEqual(
      service.operationResponse,
    );
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "Safe Tunnel operation not found" });
  });

  it("does not expose legacy or machine-scoped routes", async () => {
    const probes = [
      { method: "POST", url: "/api/safe-tunnel/login" },
      { method: "POST", url: "/api/safe-tunnel/start" },
      { method: "POST", url: "/api/safe-tunnel/stop" },
      { method: "GET", url: "/api/machines/local/safe-tunnel/status" },
    ] as const;

    for (const probe of probes) {
      const response = await app.inject(probe);
      expect(response.statusCode).toBe(404);
    }
  });

  it("maps explicit operation conflicts to a bounded public response", async () => {
    service.enable.mockRejectedValueOnce(
      new SafeTunnelOperationConflictError("already_enabled"),
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/safe-tunnel/enable",
      payload: {},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "Safe Tunnel is already enabled." });
  });

  it("does not expose unexpected transport or provider failures", async () => {
    const secret = "machineToken=piwt_mtok_v1_private provider-body=private";
    service.status.mockRejectedValueOnce(new Error(secret));
    service.enable.mockRejectedValueOnce(new Error(secret));
    service.disable.mockRejectedValueOnce(new Error(secret));
    service.operation.mockImplementationOnce(() => {
      throw new Error(secret);
    });

    const responses = await Promise.all([
      app.inject({ method: "GET", url: "/api/safe-tunnel/status" }),
      app.inject({ method: "POST", url: "/api/safe-tunnel/enable", payload: {} }),
      app.inject({ method: "POST", url: "/api/safe-tunnel/disable" }),
      app.inject({ method: "GET", url: "/api/safe-tunnel/operations/op_1" }),
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: "Safe Tunnel request failed." });
      expect(response.body).not.toContain(secret);
    }
  });
});

class FakeSafeTunnelRouteService implements SafeTunnelRouteService {
  readonly operationResponse: SafeTunnelOperationResponse = {
    id: "op_1",
    kind: "enable",
    phase: "awaiting_approval",
    startedAt: "2026-07-03T00:00:00.000Z",
    status: "running",
    stdout: "",
    stderr: "",
    userCode: "ABCD-EFGH",
    verificationUriComplete:
      "https://control.example.test/device?user_code=ABCD-EFGH",
  };

  readonly statusResponse: SafeTunnelStatusResponse = {
    config: {
      exists: false,
      path: "/data/pi-web/safe-tunnel/config.json",
      state: "missing",
    },
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

  readonly disable = vi.fn<() => Promise<SafeTunnelDisableResponse>>(() =>
    Promise.resolve(this.disableResponse));
  readonly enable = vi.fn<
    (request: SafeTunnelEnableRequest) => Promise<SafeTunnelEnableResponse>
  >(() => Promise.resolve(this.enableResponse));
  readonly operation = vi.fn<
    (operationId: string) => SafeTunnelOperationResponse | undefined
  >((operationId) => operationId === "op_1" ? this.operationResponse : undefined);
  readonly status = vi.fn<() => Promise<SafeTunnelStatusResponse>>(() =>
    Promise.resolve(this.statusResponse));
}
