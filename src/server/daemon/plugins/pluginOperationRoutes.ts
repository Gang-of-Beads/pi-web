import type { FastifyInstance, FastifyReply } from "fastify";
import { isPiWebPluginId } from "../../../shared/pluginIds.js";
import { operationNamePattern, UnknownPluginOperationError } from "../../shared/plugins/pluginOperations.js";
import { PLUGIN_OPERATION_BODY_MAX_BYTES } from "../../shared/plugins/pluginOperationContract.js";

/**
 * The daemon half of a plugin's declared operations.
 *
 * The plugin names an operation; this route decides where that name is
 * reachable. Keeping path construction here is what stops each plugin from
 * inventing its own URL shape, and it means an operation nobody declared is a
 * 404 that says which name was refused rather than a 200 that did nothing.
 */

export interface PluginOperationDispatcher {
  callOperation: (pluginId: string, operation: string, input: unknown, signal: AbortSignal) => Promise<unknown>;
}

interface PluginOperationParams {
  pluginId: string;
  operation: string;
}

export function registerPluginOperationRoutes(
  app: FastifyInstance,
  dispatcher: PluginOperationDispatcher,
  prefix = "/plugin-operations",
): void {
  app.post<{ Params: PluginOperationParams; Body: unknown }>(
    `${prefix}/:pluginId/:operation`,
    { bodyLimit: PLUGIN_OPERATION_BODY_MAX_BYTES },
    async (request, reply) => {
      const { pluginId, operation } = request.params;
      if (!isPiWebPluginId(pluginId)) return refuse(reply, 400, `Invalid PI WEB plugin id: ${pluginId}`, pluginId, operation);
      if (!operationNamePattern.test(operation)) return refuse(reply, 400, `Invalid plugin operation name: ${operation}`, pluginId, operation);

      const controller = new AbortController();
      request.raw.on("aborted", () => { controller.abort(); });
      try {
        const result = await dispatcher.callOperation(pluginId, operation, request.body, controller.signal);
        return await reply.code(200).type("application/json; charset=utf-8").send(JSON.stringify(result ?? null));
      } catch (error) {
        if (error instanceof UnknownPluginOperationError) return refuse(reply, 404, error.message, pluginId, operation);
        return refuse(reply, 500, error instanceof Error ? error.message : String(error), pluginId, operation);
      }
    },
  );
}

async function refuse(reply: FastifyReply, code: number, error: string, pluginId: string, operation: string): Promise<FastifyReply> {
  return await reply.code(code).send({ error, code: "plugin-operation-refused", pluginId, operation });
}
