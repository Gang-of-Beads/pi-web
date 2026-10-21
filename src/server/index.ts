#!/usr/bin/env node
import { createServer, type Server } from "node:https";
import type { FastifyServerFactory } from "fastify";
import { effectivePiWebConfig, maxUploadBytes, piWebTlsConfig } from "../config.js";
import { accessTokenConfig, describeAccessTokenSource } from "../accessTokenConfig.js";
import { buildApp } from "./web/app.js";
import { startProcessLogging } from "./shared/logging/processLogging.js";
import { readTlsCredentials, tlsFileSignature, watchTlsCredentials } from "./shared/tlsCredentials.js";

/**
 * Fastify sets its server timeouts only on servers it creates; a factory's server keeps Node's
 * defaults, whose 300 s request timeout cuts a slow 64 MiB upload that completes over HTTP. The
 * HTTPS server takes the values Fastify resolved instead.
 */
function httpsServerFactory(server: Server): FastifyServerFactory {
  return (handler, options) => {
    const setting = (key: string): number | undefined => {
      const value = options[key];
      return typeof value === "number" ? value : undefined;
    };
    const keepAliveTimeout = setting("keepAliveTimeout");
    const requestTimeout = setting("requestTimeout");
    const connectionTimeout = setting("connectionTimeout");
    const maxRequestsPerSocket = setting("maxRequestsPerSocket");
    if (keepAliveTimeout !== undefined) server.keepAliveTimeout = keepAliveTimeout;
    if (requestTimeout !== undefined) server.requestTimeout = requestTimeout;
    if (connectionTimeout !== undefined) server.setTimeout(connectionTimeout);
    if (maxRequestsPerSocket !== undefined && maxRequestsPerSocket > 0) server.maxRequestsPerSocket = maxRequestsPerSocket;
    return server.on("request", handler);
  };
}

const { config } = effectivePiWebConfig();
const tls = piWebTlsConfig();
const served = tls === undefined ? undefined : tlsFileSignature(tls);
const credentials = tls === undefined ? undefined : readTlsCredentials(tls);
const httpsServer = credentials === undefined ? undefined : createServer({ cert: credentials.cert, key: credentials.key });
const access = accessTokenConfig();
const port = config.port ?? 8504;
const app = await buildApp({
  bodyLimit: maxUploadBytes(process.env, config),
  ...(httpsServer === undefined ? {} : { serverFactory: httpsServerFactory(httpsServer) }),
  ...(access === undefined ? {} : { access: { tokens: access.tokens, listenPort: port } }),
});
startProcessLogging(app, "web.log");
await app.listen({ port, host: config.host ?? "127.0.0.1" });
if (access !== undefined) app.log.info(`Access token required: ${String(access.tokens.length)} token(s) from ${describeAccessTokenSource(access.source)}`);
if (httpsServer !== undefined && tls !== undefined && credentials !== undefined && served !== undefined) {
  app.log.info(`Serving HTTPS with ${tls.certFile} for ${credentials.names}, valid until ${credentials.validTo}`);
  watchTlsCredentials(httpsServer, tls, served, { info: (message) => { app.log.info(message); }, error: (message) => { app.log.error(message); } });
}
