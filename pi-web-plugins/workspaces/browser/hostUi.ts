import type { PluginHostUi } from "@gang-of-beads/pi-web/plugin-api";

/**
 * The host utilities and context actions this plugin was activated with.
 *
 * The picker elements are custom elements, so they are registered when the
 * module is first imported - before any call could hand the host in. The
 * plugin therefore records what the host gave it and imports the elements
 * afterwards, which is why this holder exists rather than parameters.
 */

let hostUi: PluginHostUi | undefined;

export function rememberWorkspacesHost(ui: PluginHostUi | undefined): void {
  hostUi = ui;
}

export function workspacesHostUi(): PluginHostUi | undefined {
  return hostUi;
}
