import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Readable } from "node:stream";
import type { ServerPluginReply, ServerPluginRequest, ServerPluginRouteContribution } from "../../../server-plugin-api.js";
import type { ServerPluginRuntime } from "../../shared/plugins/serverPluginRuntime.js";

/**
 * The host side of the route-contribution seam.
 *
 * The plugin declared core-shaped path templates; this adapter mounts each
 * one on the web app under the given prefix — `/api` and
 * `/api/machines/local`, the same dual registration every core route
 * family gets. The plugin never sees fastify types: requests are narrowed
 * to the three input faces the contract names, replies to code/header/send,
 * and the handler's signal is request cancellation - aborted when the
 * client disconnects before the response finished, never by a lifecycle
 * bound.
 */
export function mountServerPluginRoutes(app: FastifyInstance, runtime: ServerPluginRuntime, prefix: string): void {
  for (const { pluginId, route } of runtime.routeContributions()) {
    mountOne(app, pluginId, route, prefix);
  }
}

function mountOne(app: FastifyInstance, pluginId: string, route: ServerPluginRouteContribution, prefix: string): void {
  const mountedPath = `${prefix}${route.path}`;
  const register = {
    GET: () => app.get(mountedPath, toFastifyHandler(route)),
    POST: () => app.post(mountedPath, toFastifyHandler(route)),
    PUT: () => app.put(mountedPath, toFastifyHandler(route)),
    DELETE: () => app.delete(mountedPath, toFastifyHandler(route)),
  }[route.method];
  try {
    register();
  } catch (error) {
    app.log.error({ err: error, pluginId, path: mountedPath }, "plugin route mount refused; another route owns this method and path");
  }
}

type FastifyLikeRequest = FastifyRequest;
type FastifyLikeReply = FastifyReply;

function toFastifyHandler(route: ServerPluginRouteContribution): (request: FastifyLikeRequest, reply: FastifyLikeReply) => Promise<void> {
  return async (request, reply) => {
    const cancellation = requestCancellation(request, reply);
    try {
      await route.handle(
        {
          params: stringRecord(request.params),
          query: singleValuedQuery(request.query),
          headers: singleValuedHeaders(request.headers),
        },
        pluginReply(reply),
        { signal: cancellation.signal },
      );
    } finally {
      cancellation.done();
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> {
  const values: Record<string, string> = {};
  if (!isRecord(value)) return values;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") values[key] = entry;
  }
  return values;
}

function requestCancellation(request: FastifyRequest, reply: FastifyLikeReply): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const onClose = (): void => {
    if (!reply.raw.writableEnded) controller.abort();
  };
  const onFinished = (): void => {
    request.raw.off("close", onClose);
  };
  request.raw.on("close", onClose);
  reply.raw.on("finish", onFinished);
  return {
    signal: controller.signal,
    done: () => {
      onFinished();
    },
  };
}

function pluginReply(reply: FastifyLikeReply): ServerPluginReply {
  const adapter: ServerPluginReply = {
    code(status: number): ServerPluginReply {
      reply.code(status);
      return adapter;
    },
    header(name: string, value: string): ServerPluginReply {
      reply.header(name, value);
      return adapter;
    },
    async send(body: string | Uint8Array | AsyncIterable<Uint8Array>): Promise<void> {
      if (typeof body === "string" || body instanceof Uint8Array) {
        await reply.send(body);
        return;
      }
      await reply.send(Readable.from(body));
    },
  };
  return adapter;
}

function singleValuedQuery(query: FastifyRequest["query"]): Record<string, string> {
  const values: Record<string, string> = {};
  if (typeof query !== "object" || query === null) return values;
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") values[key] = value;
    else if (Array.isArray(value) && typeof value[0] === "string") values[key] = value[0];
  }
  return values;
}

function singleValuedHeaders(headers: FastifyRequest["headers"]): Record<string, string | undefined> {
  const values: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") values[key] = value;
    else if (Array.isArray(value)) values[key] = value.join(", ");
  }
  return values;
}
