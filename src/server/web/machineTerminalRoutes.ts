import { homedir } from "node:os";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { SessionProxyDaemon } from "./sessionProxyRoutes.js";
import { terminalSizeQuery } from "../shared/terminals/terminalSize.js";
import { bridgeSockets } from "./webSocketBridge.js";

/**
 * Terminals that belong to the machine rather than a project: a shell in the machine's home
 * folder, for the global pages (docs/design/go-to-scopes.md, owner 2026-10-05). The daemon keys
 * every terminal by its folder, so a machine terminal is a terminal whose folder is home; this web
 * process runs on the daemon's machine, so its home folder is the machine's. Command runs stay
 * project-scoped: their records name a project and a workspace.
 */
export function registerMachineTerminalRoutes(app: FastifyInstance, daemon: SessionProxyDaemon, prefix = "/api", machineFolder: string = homedir()): void {
  const folderQuery = `cwd=${encodeURIComponent(machineFolder)}`;

  app.get(`${prefix}/terminals`, async (_request, reply) => proxyJson(daemon, "GET", `/terminals?${folderQuery}`, undefined, reply));

  app.delete(`${prefix}/terminals`, async (_request, reply) => proxyJson(daemon, "DELETE", `/terminals?${folderQuery}`, undefined, reply));

  app.post<{ Body: { name?: string; cols?: number; rows?: number } | undefined }>(`${prefix}/terminals`, async (request, reply) => proxyJson(daemon, "POST", "/terminals", { ...request.body, cwd: machineFolder }, reply));

  app.post<{ Params: { terminalId: string } }>(`${prefix}/terminals/:terminalId/continue`, async (request, reply) => proxyJson(daemon, "POST", `/terminals/${encodeURIComponent(request.params.terminalId)}/continue`, undefined, reply));

  app.post<{ Params: { terminalId: string }; Body: unknown }>(`${prefix}/terminals/:terminalId/rename`, async (request, reply) => proxyJson(daemon, "POST", `/terminals/${encodeURIComponent(request.params.terminalId)}/rename`, request.body, reply));

  app.delete<{ Params: { terminalId: string } }>(`${prefix}/terminals/:terminalId`, async (request, reply) => proxyJson(daemon, "DELETE", `/terminals/${encodeURIComponent(request.params.terminalId)}`, undefined, reply));

  app.get<{ Params: { terminalId: string }; Querystring: { cols?: string; rows?: string } }>(`${prefix}/terminals/:terminalId/socket`, { websocket: true }, (socket, request) => {
    try {
      const sizeQuery = terminalSizeQuery(request.query.cols, request.query.rows);
      bridgeSockets(socket, daemon.connectWebSocket(`/terminals/${encodeURIComponent(request.params.terminalId)}/socket${sizeQuery}`));
    } catch (error) {
      socket.send(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "The session daemon did not answer" }));
      socket.close();
    }
  });
}

async function proxyJson(daemon: SessionProxyDaemon, method: string, path: string, body: unknown, reply: FastifyReply): Promise<unknown> {
  try {
    const upstream = await daemon.request(method, path, body);
    reply.code(upstream.statusCode);
    const contentType = upstream.headers["content-type"];
    if (contentType !== undefined && contentType !== "") reply.header("content-type", contentType);
    const value: unknown = upstream.body !== "" ? JSON.parse(upstream.body) : undefined;
    return value;
  } catch (error) {
    reply.code(502);
    return { error: error instanceof Error ? error.message : "The session daemon did not answer" };
  }
}
