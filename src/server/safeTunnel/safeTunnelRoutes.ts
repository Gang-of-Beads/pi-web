import type { FastifyInstance, FastifyReply } from "fastify";
import type {
  SafeTunnelAdvancedOverrides,
  SafeTunnelEnableRequest,
} from "../../shared/apiTypes.js";
import {
  createDefaultSafeTunnelBridgeService,
  SafeTunnelBridgeError,
  type SafeTunnelBridgeService,
} from "./safeTunnelBridgeService.js";

class SafeTunnelRequestValidationError extends Error {}

const advancedOverrideKeys = new Set([
  "controlApiUrl",
  "frpcPath",
  "localPiWebUrl",
  "machineName",
  "machineSlug",
]);

export function registerSafeTunnelRoutes(
  app: FastifyInstance,
  service?: SafeTunnelBridgeService,
): void {
  const bridge = service ?? createDefaultSafeTunnelBridgeService({
    serverAddress: () => app.server.address(),
  });

  app.addHook("onReady", async () => {
    await bridge.startup();
  });
  app.addHook("onClose", async () => {
    await bridge.shutdown();
  });

  app.get("/api/safe-tunnel/status", async (_request, reply) => {
    try {
      return await bridge.status();
    } catch (error) {
      return sendSafeTunnelError(reply, error);
    }
  });

  app.post<{ Body: unknown }>("/api/safe-tunnel/enable", async (request, reply) => {
    try {
      const response = await bridge.enable(parseEnableRequest(request.body));
      reply.code(202).send(response);
      return;
    } catch (error) {
      return sendSafeTunnelError(reply, error);
    }
  });

  app.post("/api/safe-tunnel/disable", async (_request, reply) => {
    try {
      return await bridge.disable();
    } catch (error) {
      return sendSafeTunnelError(reply, error);
    }
  });

  app.get<{ Params: { operationId: string } }>("/api/safe-tunnel/operations/:operationId", async (request, reply) => {
    const operation = bridge.operation(request.params.operationId);
    if (operation === undefined) {
      return reply.code(404).send({ error: "Safe Tunnel operation not found" });
    }
    return operation;
  });
}

function parseEnableRequest(body: unknown): SafeTunnelEnableRequest {
  if (body === undefined) return {};
  const request = requireRequestObject(
    body,
    "Safe Tunnel enable request body must be an object",
  );
  assertOnlyKeys(request, new Set(["advanced"]), "Safe Tunnel enable request");
  if (request["advanced"] === undefined) return {};

  const advanced = requireRequestObject(
    request["advanced"],
    "Safe Tunnel advanced overrides must be an object",
  );
  assertOnlyKeys(advanced, advancedOverrideKeys, "Safe Tunnel advanced overrides");
  const parsed: SafeTunnelAdvancedOverrides = {};
  copyOptionalString(advanced, parsed, "controlApiUrl", "Safe Tunnel advanced controlApiUrl");
  copyOptionalString(advanced, parsed, "machineName", "Safe Tunnel advanced machineName");
  copyOptionalString(advanced, parsed, "machineSlug", "Safe Tunnel advanced machineSlug");
  copyOptionalString(advanced, parsed, "localPiWebUrl", "Safe Tunnel advanced localPiWebUrl");
  copyOptionalString(advanced, parsed, "frpcPath", "Safe Tunnel advanced frpcPath");
  return Object.keys(parsed).length === 0 ? {} : { advanced: parsed };
}

function copyOptionalString(
  source: Readonly<Record<string, unknown>>,
  target: SafeTunnelAdvancedOverrides,
  key: keyof SafeTunnelAdvancedOverrides,
  fieldName: string,
): void {
  const value = optionalNonEmptyString(source[key], fieldName);
  if (value !== undefined) target[key] = value;
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

function requireRequestObject(
  value: unknown,
  message: string,
): Record<string, unknown> {
  if (!isRecord(value)) throw new SafeTunnelRequestValidationError(message);
  return value;
}

function assertOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  allowedKeys: ReadonlySet<string>,
  label: string,
): void {
  const unsupported = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unsupported !== undefined) {
    throw new SafeTunnelRequestValidationError(`${label} contains unsupported field: ${unsupported}`);
  }
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
