import type { SessionDaemonRequestClient } from "../sessiondClient/sessionDaemonClient.js";

/**
 * The web process asks its session daemon to apply a plugin toggle live (B19 slice A).
 *
 * The web process owns the config file, so it sees the toggle first; it reconciles its own plugin
 * runtime and then asks the daemon to reconcile its runtime. The daemon reads the same config,
 * so the request carries nothing. Reached on the daemon's own socket; the web process does not
 * forward this path from browsers.
 */
export const PLUGIN_RECONCILE_PATH = "/plugins/reconcile";

/** Ask the daemon to reconcile. An older daemon without the route answers 404, and its plugins keep saying "Restart required". */
export async function askDaemonToReconcilePlugins(daemon: SessionDaemonRequestClient): Promise<void> {
  const answer = await daemon.request("POST", PLUGIN_RECONCILE_PATH, {});
  if (answer.statusCode >= 300) throw new Error(`The session daemon did not reconcile its plugins (${String(answer.statusCode)})`);
}
