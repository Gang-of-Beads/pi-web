import type { FastifyInstance } from "fastify";
import type { SessionDaemonRequestClient } from "../../shared/sessiondClient/sessionDaemonClient.js";
import { PLUGIN_OPERATION_BODY_MAX_BYTES } from "../../shared/plugins/pluginOperationContract.js";

/**
 * Browser-facing half of a plugin's declared operations. Execution stays in
 * the daemon, which owns the plugin runtime; this process only forwards, and
 * says plainly when the daemon could not be reached rather than presenting an
 * unreachable daemon as a plugin that answered nothing.
 */
export function registerPluginOperationProxyRoutes(
  app: FastifyInstance,
  daemon: SessionDaemonRequestClient,
  prefix = "/api/plugins",
): void {
  app.post<{ Params: { pluginId: string; operation: string }; Body: unknown }>(
    `${prefix}/:pluginId/:operation`,
    { bodyLimit: PLUGIN_OPERATION_BODY_MAX_BYTES },
    async (request, reply) => {
      const { pluginId, operation } = request.params;
      const path = `/plugin-operations/${encodeURIComponent(pluginId)}/${encodeURIComponent(operation)}`;
      try {
        const upstream = await daemon.request("POST", path, request.body);
        return await reply
          .code(upstream.statusCode)
          .type("application/json; charset=utf-8")
          .send(upstream.body === "" ? "null" : upstream.body);
      } catch (error) {
        return await reply.code(502).send({
          error: `Session daemon unavailable: ${error instanceof Error ? error.message : String(error)}`,
          code: "daemon-unavailable",
          pluginId,
          operation,
        });
      }
    },
  );
}
