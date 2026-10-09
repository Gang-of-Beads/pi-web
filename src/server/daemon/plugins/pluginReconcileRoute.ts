import type { FastifyInstance } from "fastify";
import { PLUGIN_RECONCILE_PATH } from "../../shared/plugins/pluginReconcile.js";

/** Where the web process asks the daemon to apply a plugin toggle live; answers once the daemon's runtime has. */
export function registerPluginReconcileRoute(app: FastifyInstance, reconcile: () => Promise<void>): void {
  app.post(PLUGIN_RECONCILE_PATH, async () => {
    await reconcile();
    return { reconciled: true };
  });
}
