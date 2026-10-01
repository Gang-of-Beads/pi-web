import type { FastifyInstance } from "fastify";
import type { RealtimeEvent } from "../../../shared/apiTypes.js";
import { CHANGE_EVENTS, CHANGE_NUDGE_PATH, isChangeKind } from "../../shared/sessiondClient/changeNudge.js";

export interface ChangePublisher {
  publishRealtime(event: RealtimeEvent): void;
}

/**
 * Where a web-process writer tells the daemon a store it owns changed (pins today), and the
 * daemon announces it on every browser's realtime socket. Reached on the daemon's own socket;
 * the web process does not forward this path from browsers.
 */
export function registerChangeNudgeRoutes(app: FastifyInstance, publisher: ChangePublisher): void {
  app.post<{ Body: unknown }>(CHANGE_NUDGE_PATH, async (request, reply) => {
    const kind: unknown = typeof request.body === "object" && request.body !== null ? Reflect.get(request.body, "kind") : undefined;
    if (!isChangeKind(kind)) return reply.code(400).send({ error: "Unknown change kind" });
    publisher.publishRealtime(CHANGE_EVENTS[kind]);
    return { published: kind };
  });
}
