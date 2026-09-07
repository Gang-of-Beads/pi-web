import { html } from "lit";
import type { PluginRuntimeContext } from "@gang-of-beads/pi-web/plugin-api";
import { machinesHostUi } from "./hostUi";
import "./MachineDialog.js";

/**
 * The add-machine dialog, opened through the host's dialog seam.
 *
 * The shell owns the modal surface - focus, escape, backdrop, layer order -
 * so the plugin only hands in the form and a close callback. A submit that
 * resolves without a failure reason closed the deal; the dialog closes. The
 * create call itself comes from the remembered activation context, so the
 * dialog never calls a PI WEB API and never spells a URL.
 */

let activeDialog: { close(): void } | undefined;

export function openAddMachineDialog(context: PluginRuntimeContext): void {
  if (activeDialog !== undefined) return;
  const ui = machinesHostUi();
  if (ui === undefined) return;
  activeDialog = ui.showDialog({
    label: "Add machine",
    content: html`<machine-dialog
      .onSubmit=${(input: Parameters<NonNullable<PluginRuntimeContext["createMachine"]>>[0]) => (context.createMachine?.(input) ?? Promise.resolve("This host offers no machine creation.")).then((failure) => {
        if (failure === undefined) activeDialog?.close();
        return failure;
      })}
      .onCancel=${() => { activeDialog?.close(); }}
    ></machine-dialog>`,
    onClose: () => { activeDialog = undefined; },
  });
}
