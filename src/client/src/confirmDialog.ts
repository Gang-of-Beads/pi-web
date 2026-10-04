import { html } from "lit";
import "./components/ConfirmCard";
import type { PluginConfirmRequest, PluginDialogHandle, PluginDialog } from "./plugins/types";

/** What is about to happen (naming the thing), its consequence, and the verb on the confirming key. */
export type ConfirmRequest = PluginConfirmRequest;

interface ConfirmDialogHost {
  showDialog(dialog: PluginDialog): PluginDialogHandle;
}

/**
 * Ask the reader to confirm, on the app's dialog surface (B40). Resolves true only for the
 * confirming key; every other close - Cancel, Escape, the backdrop, the back gesture, an
 * unregistration - resolves false, exactly once.
 */
export function askConfirmation(host: ConfirmDialogHost, request: ConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (confirmed: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(confirmed);
    };
    const handle = host.showDialog({
      label: request.title,
      presentation: "alert",
      content: html`<pi-confirm-card
        .heading=${request.title}
        .message=${request.message}
        .confirmLabel=${request.confirmLabel}
        .tone=${request.tone ?? "default"}
        .onAnswer=${(confirmed: boolean) => { settle(confirmed); handle.close(); }}
      ></pi-confirm-card>`,
      onClose: () => { settle(false); },
    });
  });
}

/**
 * A provider's one-string confirmation (the git workspace removal sends "Delete workspace x?" and
 * then the details after a blank line) as the card's title and message.
 */
export function confirmationText(text: string): Pick<ConfirmRequest, "title" | "message"> {
  const split = text.indexOf("\n\n");
  if (split < 0) return { title: text.trim(), message: "" };
  return { title: text.slice(0, split).trim(), message: text.slice(split + 2).trim() };
}
