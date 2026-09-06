import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Readable } from "node:stream";
import type { ServerPluginReply, ServerPluginRouteBody, ServerPluginRouteContribution } from "../../../server-plugin-api.js";
import type { JsonValue } from "../../../shared/pluginApiTypes.js";
import { requestCancellation } from "../../shared/requestCancellation.js";
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
export function mountServerPluginRoutes(app: FastifyInstance, runtime: Pick<ServerPluginRuntime, "routeContributions">, prefix: string): void {
  registerPluginRouteBodyParsers(app);
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
    PATCH: () => app.patch(mountedPath, toFastifyHandler(route)),
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
          body: routeBody(request.body),
        },
        pluginReply(reply),
        { signal: cancellation.signal },
      );
    } finally {
      cancellation.dispose();
    }
  };
}

function routeBody(body: unknown): ServerPluginRouteBody | undefined {
  if (body instanceof Uint8Array) return body;
  if (typeof body === "string") return Buffer.from(body, "utf8");
  if (isPlainJsonObject(body)) return body;
  return undefined;
}

function isPlainJsonObject(body: unknown): body is Record<string, JsonValue> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return false;
  return Object.values(body).every(isJsonValue);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return typeof value === "object" && isPlainJsonObject(value);
}

/**
 * Fastify's default parser only handles JSON; a plugin route that writes
 * workspace files needs text and arbitrary binary bodies. Registration is
 * app-level and must tolerate repeats: the same parsers the core file routes
 * registered, so a body the core could read the plugin can read identically.
 */
function registerPluginRouteBodyParsers(app: FastifyInstance): void {
  try { app.addContentTypeParser("text/plain", { parseAs: "string" }, (_request, body, done) => { done(null, Buffer.from(body)); }); } catch { /* already registered */ }
  try { app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_request, body, done) => { done(null, body); }); } catch { /* already registered */ }
  try { app.addContentTypeParser(/^([a-z]+\/[a-z0-9.+-]+)$/u, { parseAs: "buffer" }, (_request, body, done) => { done(null, body); }); } catch { /* already registered */ }
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
