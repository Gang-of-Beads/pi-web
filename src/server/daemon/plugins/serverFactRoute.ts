import type { FastifyInstance } from "fastify";
import type { ServerFactFeed } from "../../shared/plugins/serverFactChannel.js";
import { SERVER_FACTS_PATH } from "../../shared/plugins/serverFactChannel.js";

/** A relay that falls this far behind is cut, so it reconnects and its plugins hear the gap. */
const MAX_RELAY_BUFFERED_BYTES = 1024 * 1024;

/**
 * Where the web process subscribes to the daemon's server facts, one JSON fact per frame. A fact
 * is sent only to a relay connected when it is decided; nothing is kept for a relay that is not.
 */
export function registerServerFactRoute(app: FastifyInstance, facts: ServerFactFeed): void {
  app.get(SERVER_FACTS_PATH, { websocket: true }, (socket) => {
    const unsubscribe = facts.subscribe({
      fact: (fact) => {
        if (socket.readyState !== socket.OPEN) return;
        if (socket.bufferedAmount > MAX_RELAY_BUFFERED_BYTES) {
          socket.terminate();
          return;
        }
        socket.send(JSON.stringify(fact));
      },
      link: () => undefined,
    });
    socket.on("close", unsubscribe);
  });
}
