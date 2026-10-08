import type { FastifyInstance, FastifyReply } from "fastify";
import { adoptedPins, globalPin, pinOrder, projectPin, type PinChange, type SessionPinStore, type SessionPins } from "../shared/storage/sessionPinStore.js";

class SessionPinRequestError extends Error {}

/**
 * The machine's pin set, readable and writable by every device that browses
 * it. Mounted under both the plain and the machine-scoped prefix so the fleet
 * proxy reaches a remote machine's own pins rather than the gateway's: the
 * gateway forwards `/api/machines/<id>/session-pins` to that machine's web
 * process (`FEDERATED_HTTP_ROUTES`, P5 slice b), whose store announces a
 * change to its own daemon (P5 slice a); this route only reads and writes.
 * Every answer carries both kinds of pin (B49): `projectPins` is always present, so a page can tell
 * a machine that keeps project pins from an older one that answers without the field.
 */
export function registerSessionPinRoutes(app: FastifyInstance, store: SessionPinStore, prefix = "/api"): void {
  const base = prefix.replace(/\/+$/u, "") === "" ? "/api" : prefix.replace(/\/+$/u, "");

  app.get(`${base}/session-pins`, async (_request, reply) => {
    try {
      return pinAnswer(await store.read());
    } catch (error) {
      return failed(reply, error);
    }
  });

  app.post<{ Body: unknown }>(`${base}/session-pins`, async (request, reply) => {
    try {
      return pinAnswer(await store.apply(parsePinRequest(request.body)));
    } catch (error) {
      return failed(reply, error);
    }
  });
}

function pinAnswer(pins: SessionPins): { pinnedSessionIds: readonly string[]; projectPins: Readonly<Record<string, readonly string[]>> } {
  return { pinnedSessionIds: pins.global, projectPins: pins.projects };
}

/** `{ adopt }`, `{ order }` or `{ order, projectId }` for a dragged order, `{ sessionId, pinned }` for the global pin, or `{ sessionId, pinned, projectId }` for that project's. */
function parsePinRequest(body: unknown): PinChange {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new SessionPinRequestError("A pin change needs a body");
  const adopt: unknown = Reflect.get(body, "adopt");
  if (adopt !== undefined) {
    if (!Array.isArray(adopt) || adopt.some((id) => typeof id !== "string")) throw new SessionPinRequestError("adopt must be a list of session ids");
    return adoptedPins(adopt.filter((id): id is string => typeof id === "string" && id !== ""));
  }
  const order: unknown = Reflect.get(body, "order");
  if (order !== undefined) return parseOrderRequest(order, Reflect.get(body, "projectId"));
  const sessionId: unknown = Reflect.get(body, "sessionId");
  const pinned: unknown = Reflect.get(body, "pinned");
  const projectId: unknown = Reflect.get(body, "projectId");
  if (typeof sessionId !== "string" || sessionId === "") throw new SessionPinRequestError("A pin change needs a session id");
  if (typeof pinned !== "boolean") throw new SessionPinRequestError("A pin change needs pinned: true or false");
  if (projectId === undefined) return globalPin(sessionId, pinned);
  if (typeof projectId !== "string" || projectId === "") throw new SessionPinRequestError("projectId must name a project");
  return projectPin(projectId, sessionId, pinned);
}

function parseOrderRequest(order: unknown, projectId: unknown): PinChange {
  if (!Array.isArray(order) || order.some((id) => typeof id !== "string" || id === "")) throw new SessionPinRequestError("order must be a list of session ids");
  const ids = order.filter((id): id is string => typeof id === "string");
  if (projectId === undefined) return pinOrder(ids);
  if (typeof projectId !== "string" || projectId === "") throw new SessionPinRequestError("projectId must name a project");
  return pinOrder(ids, projectId);
}

function failed(reply: FastifyReply, error: unknown): FastifyReply {
  const message = error instanceof Error ? error.message : "Session pins could not be read";
  return reply.status(error instanceof SessionPinRequestError ? 400 : 500).send({ error: message });
}
