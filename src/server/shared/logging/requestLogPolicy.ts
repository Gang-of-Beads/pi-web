import type { FastifyInstance } from "fastify";

/**
 * Which HTTP requests the web and daemon logs record (owner, 2026-10-04: log level and retention,
 * set in Settings). Fastify's own request logging wrote two lines for every request, which was
 * 99.7% of 8504's 15.8 GB web.log; it is off, and this hook writes one line for the requests the
 * chosen level keeps.
 */
export type LogLevelChoice = "errors" | "requests" | "debug";

/** A request slower than this is logged even at the quietest level. */
export const SLOW_REQUEST_MS = 1_000;

const KEEPS_REQUEST: Readonly<Record<LogLevelChoice, (statusCode: number, elapsedMs: number) => boolean>> = {
  errors: (statusCode, elapsedMs) => statusCode >= 500 || elapsedMs >= SLOW_REQUEST_MS,
  requests: () => true,
  debug: () => true,
};

/** The logger level each choice sets; lifecycle messages are info, so only debug opens more. */
const LOGGER_LEVEL: Readonly<Record<LogLevelChoice, "info" | "debug">> = {
  errors: "info",
  requests: "info",
  debug: "debug",
};

export function keepsRequest(level: LogLevelChoice, statusCode: number, elapsedMs: number): boolean {
  return KEEPS_REQUEST[level](statusCode, elapsedMs);
}

export function loggerLevel(level: LogLevelChoice): "info" | "debug" {
  return LOGGER_LEVEL[level];
}

/**
 * One line per kept request, written when it completes. `level` is read per request, so a change
 * saved in Settings applies without a restart once the caller's settings refresh picks it up.
 */
export function installRequestLogging(app: FastifyInstance, level: () => LogLevelChoice): void {
  app.addHook("onResponse", async (request, reply) => {
    const elapsedMs = reply.elapsedTime;
    if (!keepsRequest(level(), reply.statusCode, elapsedMs)) return;
    request.log.info({ method: request.method, url: request.url, statusCode: reply.statusCode, responseTime: Math.round(elapsedMs) }, "request completed");
  });
}
