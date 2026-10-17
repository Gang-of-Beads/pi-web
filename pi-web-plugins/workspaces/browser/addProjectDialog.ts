import { html } from "lit";
import type { PluginProjectCreateInput, PluginRuntimeContext } from "@gang-of-beads/pi-web/plugin-api";
import { workspacesHostUi } from "./hostUi";
import "./ProjectDialog";

/**
 * The add-project dialog, opened through the host's dialog seam.
 *
 * The shell owns the modal surface - focus, escape, backdrop, layer order -
 * so the plugin only hands in the form and a close callback. A submit that
 * resolves without a failure reason closed the deal; the dialog closes. Every host face
 * the form needs (the folder listing, directory suggestions, the path's existing trust,
 * the create call itself) comes from the activation context, so the dialog never calls a
 * PI WEB API and never spells a URL.
 *
 * The folder access is taken from the host once, when the dialog opens: it is bound to the
 * machine selected then, so every listing and the final add stay on that machine (r67). A host
 * without folder access gets the typed-path form, on whatever machine it selects.
 */

let activeDialog: { close(): void } | undefined;

export function openAddProjectDialog(context: PluginRuntimeContext): void {
  if (activeDialog !== undefined) return;
  const ui = workspacesHostUi();
  if (ui === undefined) return;
  const folders = context.projectFolders?.();
  const directories = folders?.directories ?? ((query: string, signal: AbortSignal) => context.projectDirectories(query, signal));
  const trust = folders?.trust ?? ((path: string) => context.projectTrust(path));
  const create = folders?.create ?? ((input: PluginProjectCreateInput) => context.createProject(input));
  activeDialog = ui.showDialog({
    label: "Add project",
    content: html`<project-dialog
      .machine=${folders?.machine}
      .listFolder=${folders?.listFolder}
      .projectDirectories=${directories}
      .projectTrust=${trust}
      .onSubmit=${(path: string, createMissing: boolean, trustChoice: { trusted: boolean; changed: boolean } | undefined) => create({ path, create: createMissing, ...(trustChoice === undefined ? {} : { trust: trustChoice }) }).then((failure) => {
        if (failure === undefined) activeDialog?.close();
        return failure;
      })}
      .onCancel=${() => { activeDialog?.close(); }}
    ></project-dialog>`,
    onClose: () => { activeDialog = undefined; },
  });
}
