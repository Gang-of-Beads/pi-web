
import { html } from "lit";
import type { PluginRuntimeContext } from "@gang-of-beads/pi-web/plugin-api";
import { workspacesHostUi } from "./hostUi";
import "./ProjectDialog";

/**
 * The add-project dialog, opened through the host's dialog seam.
 *
 * The shell owns the modal surface - focus, escape, backdrop, layer order -
 * so the plugin only hands in the form and a close callback. Every host face
 * the form needs (directory suggestions, the path's existing trust, the
 * create call itself) comes from the remembered activation context, so the
 * dialog never calls a PI WEB API and never spells a URL.
 */

let activeDialog: { close(): void } | undefined;

export function openAddProjectDialog(context: PluginRuntimeContext): void {
  if (activeDialog !== undefined) return;
  const ui = workspacesHostUi();
  if (ui === undefined) return;
  activeDialog = ui.showDialog({
    label: "Add project",
    content: html`<project-dialog
      .projectDirectories=${(query: string, signal: AbortSignal) => context.projectDirectories(query, signal)}
      .projectTrust=${(path: string) => context.projectTrust(path)}
      .onSubmit=${(path: string, create: boolean, trust: { trusted: boolean; changed: boolean } | undefined) => context.createProject({ path, create, ...(trust === undefined ? {} : { trust }) })}
      .onCancel=${() => { activeDialog?.close(); }}
    ></project-dialog>`,
    onClose: () => { activeDialog = undefined; },
  });
}