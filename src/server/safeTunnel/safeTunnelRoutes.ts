import type { FastifyInstance, FastifyReply } from "fastify";
import type {
  SafeTunnelAdvancedOverrides,
  SafeTunnelDisableResponse,
  SafeTunnelEnableRequest,
  SafeTunnelEnableResponse,
  SafeTunnelOperationResponse,
  SafeTunnelStatusResponse,
} from "../../shared/apiTypes.js";

const enableRequestKeys = new Set(["advanced"]);
const advancedOverrideKeys = new Set([
  "controlApiUrl",
  "frpcPath",
  "localPiWebUrl",
  "machineName",
  "machineSlug",
]);
const unexpectedErrorMessage = "Safe Tunnel request failed.";

export interface SafeTunnelRouteService {
  disable(): Promise<SafeTunnelDisableResponse>;
  enable(request: SafeTunnelEnableRequest): Promise<SafeTunnelEnableResponse>;
  operation(operationId: string): SafeTunnelOperationResponse | undefined;
  status(): Promise<SafeTunnelStatusResponse>;
}

export type SafeTunnelOperationConflict =
  | "already_enabled"
  | "operation_in_progress";

/** A bounded, browser-safe conflict that the application adapter may expose. */
export class SafeTunnelOperationConflictError extends Error {
  constructor(readonly code: SafeTunnelOperationConflict) {
    super(code === "already_enabled"
      ? "Safe Tunnel is already enabled."
      : "A Safe Tunnel operation is already running.");
    this.name = "SafeTunnelOperationConflictError";
  }
}

/**
 * Registers only the Safe Tunnel HTTP contract. Production composition and
 * lifecycle ownership stay outside this dormant leaf.
 */
export function registerSafeTunnelRoutes(
  app: FastifyInstance,
  service: SafeTunnelRouteService,
): void {
  app.get("/api/safe-tunnel/status", async (_request, reply) => {
    try {
      return await service.status();
    } catch (error) {
      return sendSafeTunnelError(reply, error);
    }
  });

  app.post<{ Body: unknown }>("/api/safe-tunnel/enable", async (request, reply) => {
    try {
      const response = await service.enable(parseEnableRequest(request.body));
      return await reply.code(202).send(response);
    } catch (error) {
      return sendSafeTunnelError(reply, error);
    }
  });

  app.post("/api/safe-tunnel/disable", async (_request, reply) => {
    try {
      return await service.disable();
    } catch (error) {
      return sendSafeTunnelError(reply, error);
    }
  });

  app.get<{ Params: { operationId: string } }>(
    "/api/safe-tunnel/operations/:operationId",
    (request, reply) => {
      try {
        const operation = service.operation(request.params.operationId);
        if (operation === undefined) {
          return reply.code(404).send({ error: "Safe Tunnel operation not found" });
        }
        return operation;
      } catch (error) {
        return sendSafeTunnelError(reply, error);
      }
    },
  );
}

class SafeTunnelRequestValidationError extends Error {}

function parseEnableRequest(body: unknown): SafeTunnelEnableRequest {
  if (body === undefined) return {};
  const request = requireRequestObject(
    body,
    "Safe Tunnel enable request body must be an object",
  );
  assertOnlyKeys(request, enableRequestKeys, "Safe Tunnel enable request");
  if (request["advanced"] === undefined) return {};

  const advanced = requireRequestObject(
    request["advanced"],
    "Safe Tunnel advanced overrides must be an object",
  );
  assertOnlyKeys(advanced, advancedOverrideKeys, "Safe Tunnel advanced overrides");

  const parsed: SafeTunnelAdvancedOverrides = {};
  copyOptionalString(
    advanced,
    parsed,
    "controlApiUrl",
    "Safe Tunnel advanced controlApiUrl",
  );
  copyOptionalString(
    advanced,
    parsed,
    "machineName",
    "Safe Tunnel advanced machineName",
  );
  copyOptionalString(
    advanced,
    parsed,
    "machineSlug",
    "Safe Tunnel advanced machineSlug",
  );
  copyOptionalString(
    advanced,
    parsed,
    "localPiWebUrl",
    "Safe Tunnel advanced localPiWebUrl",
  );
  copyOptionalString(
    advanced,
    parsed,
    "frpcPath",
    "Safe Tunnel advanced frpcPath",
  );
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

function optionalNonEmptyString(
  value: unknown,
  fieldName: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SafeTunnelRequestValidationError(
      `${fieldName} must be a non-empty string`,
    );
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
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new SafeTunnelRequestValidationError(
      `${label} contains an unsupported field`,
    );
  }
}

function sendSafeTunnelError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof SafeTunnelRequestValidationError) {
    return reply.code(400).send({ error: error.message });
  }
  if (error instanceof SafeTunnelOperationConflictError) {
    return reply.code(409).send({ error: error.message });
  }
  return reply.code(500).send({ error: unexpectedErrorMessage });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
