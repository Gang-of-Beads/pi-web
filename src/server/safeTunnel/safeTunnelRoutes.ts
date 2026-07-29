import type { FastifyInstance, FastifyReply } from "fastify";
import type { SafeTunnelLoginRequest, SafeTunnelStartRequest } from "../../shared/apiTypes.js";
import { createDefaultSafeTunnelBridgeService, SafeTunnelBridgeError, type SafeTunnelBridgeService } from "./safeTunnelBridgeService.js";

class SafeTunnelRequestValidationError extends Error {}

export function registerSafeTunnelRoutes(app: FastifyInstance, service: SafeTunnelBridgeService = createDefaultSafeTunnelBridgeService()): void {
  app.addHook("onReady", async () => {
    await service.startup();
  });
  app.addHook("onClose", async () => {
    await service.shutdown();
  });

  app.get("/api/safe-tunnel/status", async (_request, reply) => {
    try {
      return await service.status();
    } catch (error) {
      return sendSafeTunnelError(reply, error);
    }
  });

  app.post<{ Body: unknown }>("/api/safe-tunnel/login", async (request, reply) => {
    try {
      const response = await service.login(parseLoginRequest(request.body));
      reply.code(202).send(response);
      return;
    } catch (error) {
      return sendSafeTunnelError(reply, error);
    }
  });

  app.get<{ Params: { operationId: string } }>("/api/safe-tunnel/operations/:operationId", async (request, reply) => {
    const operation = service.operation(request.params.operationId);
    if (operation === undefined) return reply.code(404).send({ error: "Safe Tunnel operation not found" });
    return operation;
  });

  app.post<{ Body: unknown }>("/api/safe-tunnel/start", async (request, reply) => {
    try {
      const response = await service.start(parseStartRequest(request.body));
      reply.code(202).send(response);
      return;
    } catch (error) {
      return sendSafeTunnelError(reply, error);
    }
  });

  app.post("/api/safe-tunnel/stop", async (_request, reply) => {
    try {
      return await service.stop();
    } catch (error) {
      return sendSafeTunnelError(reply, error);
    }
  });
}

function parseLoginRequest(body: unknown): SafeTunnelLoginRequest {
  const request = requireRequestObject(body, "Safe Tunnel login request body must be an object");
  const controlApiUrl = requireNonEmptyString(request["controlApiUrl"], "Safe Tunnel login controlApiUrl");
  const machineName = requireNonEmptyString(request["machineName"], "Safe Tunnel login machineName");
  const machineSlug = requireNonEmptyString(request["machineSlug"], "Safe Tunnel login machineSlug");
  const localPiWebUrl = optionalNonEmptyString(request["localPiWebUrl"], "Safe Tunnel login localPiWebUrl");
  const frpcPath = optionalNonEmptyString(request["frpcPath"], "Safe Tunnel login frpcPath");
  const parsed: SafeTunnelLoginRequest = { controlApiUrl, machineName, machineSlug };

  if (localPiWebUrl !== undefined && frpcPath !== undefined) return { ...parsed, localPiWebUrl, frpcPath };
  if (localPiWebUrl !== undefined) return { ...parsed, localPiWebUrl };
  if (frpcPath !== undefined) return { ...parsed, frpcPath };
  return parsed;
}

function parseStartRequest(body: unknown): SafeTunnelStartRequest {
  if (body === undefined) return {};
  const request = requireRequestObject(body, "Safe Tunnel start request body must be an object");
  const frpcPath = optionalNonEmptyString(request["frpcPath"], "Safe Tunnel start frpcPath");
  return frpcPath === undefined ? {} : { frpcPath };
}

function optionalNonEmptyString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) return undefined;
  return requireNonEmptyString(value, fieldName);
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SafeTunnelRequestValidationError(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

function requireRequestObject(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) throw new SafeTunnelRequestValidationError(message);
  return value;
}

function sendSafeTunnelError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof SafeTunnelRequestValidationError) {
    return reply.code(400).send({ error: error.message });
  }

  if (error instanceof SafeTunnelBridgeError) {
    return reply.code(error.statusCode).send({ error: error.message });
  }

  return reply.code(500).send({ error: errorMessage(error) });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
