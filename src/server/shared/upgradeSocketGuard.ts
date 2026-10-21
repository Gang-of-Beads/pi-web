import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import type { FastifyBaseLogger } from "fastify";

type UpgradeSocketFailure = "client-gone" | "handled-by-websocket" | "socket-failed";

const CLIENT_GONE_CODES: ReadonlySet<unknown> = new Set(["EPIPE", "ECONNRESET", "ECONNABORTED", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH"]);

/**
 * `ws` puts its own error listener on a socket it takes and reports the failure through the
 * WebSocket, so a socket with another error listener needs no second warning from here.
 */
function upgradeSocketFailure(error: Error, socket: Duplex): UpgradeSocketFailure {
  if ("code" in error && CLIENT_GONE_CODES.has(error.code)) return "client-gone";
  return socket.listenerCount("error") > 1 ? "handled-by-websocket" : "socket-failed";
}

type UpgradeSocketLogger = Pick<FastifyBaseLogger, "debug" | "warn">;

const LOG_UPGRADE_SOCKET_FAILURE: Readonly<Record<UpgradeSocketFailure, (logger: UpgradeSocketLogger, details: Record<string, unknown>) => void>> = {
  "client-gone": (logger, details) => { logger.debug(details, "an upgrade socket's client went away"); },
  "handled-by-websocket": (logger, details) => { logger.debug(details, "an upgrade socket failed under its WebSocket"); },
  "socket-failed": (logger, details) => { logger.warn(details, "an upgrade socket failed"); },
};

/**
 * Node takes the HTTP server's own 'error' listener off a socket before it emits 'upgrade', and
 * `ws` adds its listener only once it takes the handshake. An upgrade request answered over HTTP
 * instead (a 404 for a route this process does not have, the daemon's 503 while it quiesces, a
 * refused preflight) wrote to a socket with no listener, so a client gone before the answer threw
 * an uncaught EPIPE and took the session daemon, and every session on it, down (2026-10-21).
 * Every upgrade socket gets a listener here, before anything can write to it.
 *
 * At close, `@fastify/websocket` removes its own 'upgrade' listener; an upgrade arriving after
 * that reaches only this one, nobody would answer it, and `server.close()` would wait on it, so
 * it is destroyed.
 */
export function guardUpgradeSockets(server: Server, logger: UpgradeSocketLogger): void {
  server.on("upgrade", (request: IncomingMessage, socket: Duplex) => {
    socket.on("error", (error) => {
      LOG_UPGRADE_SOCKET_FAILURE[upgradeSocketFailure(error, socket)](logger, { err: error, url: request.url });
      socket.destroy();
    });
    if (server.listenerCount("upgrade") === 1) socket.destroy();
  });
}
