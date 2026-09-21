import type { FastifyInstance, FastifyReply } from "fastify";
import type { SessionPinStore } from "../shared/storage/sessionPinStore.js";

class SessionPinRequestError extends Error {}

/**
 * The machine's pin set, readable and writable by every device that browses
 * it. Mounted under both the plain and the machine-scoped prefix so the fleet
 * proxy reaches a remote machine's own pins rather than the gateway's.
 */
export function registerSessionPinRoutes(app: FastifyInstance, store: SessionPinStore, prefix = "/api"): void {
  const base = prefix.replace(/\/+$/u, "") === "" ? "/api" : prefix.replace(/\/+$/u, "");

  app.get(`${base}/session-pins`, async (_request, reply) => {
    try {
      return { pinnedSessionIds: await store.list() };
    } catch (error) {
      return failed(reply, error);
    }
  });

  app.post<{ Body: unknown }>(`${base}/session-pins`, async (request, reply) => {
    try {
      const { sessionId, pinned, adopt } = parsePinRequest(request.body);
      if (adopt !== undefined) return { pinnedSessionIds: await store.adopt(adopt) };
      if (sessionId === undefined) throw new SessionPinRequestError("A pin change needs a session id");
      return { pinnedSessionIds: pinned ? await store.pin(sessionId) : await store.unpin(sessionId) };
    } catch (error) {
      return failed(reply, error);
    }
  });
}

function parsePinRequest(body: unknown): { sessionId?: string; pinned: boolean; adopt?: string[] } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new SessionPinRequestError("A pin change needs a body");
  const adopt: unknown = Reflect.get(body, "adopt");
  if (adopt !== undefined) {
    if (!Array.isArray(adopt) || adopt.some((id) => typeof id !== "string")) throw new SessionPinRequestError("adopt must be a list of session ids");
    return { pinned: true, adopt: adopt.filter((id): id is string => typeof id === "string" && id !== "") };
  }
  const sessionId: unknown = Reflect.get(body, "sessionId");
  const pinned: unknown = Reflect.get(body, "pinned");
  if (typeof sessionId !== "string" || sessionId === "") throw new SessionPinRequestError("A pin change needs a session id");
  if (typeof pinned !== "boolean") throw new SessionPinRequestError("A pin change needs pinned: true or false");
  return { sessionId, pinned };
}

function failed(reply: FastifyReply, error: unknown): FastifyReply {
  const message = error instanceof Error ? error.message : "Session pins could not be read";
  return reply.status(error instanceof SessionPinRequestError ? 400 : 500).send({ error: message });
}
