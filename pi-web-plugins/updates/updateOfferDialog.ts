import type { HtmlTemplateTag, PluginHostUi } from "@gang-of-beads/pi-web/plugin-api";

/**
 * The PI WEB update offer as one host-level dialog.
 *
 * It used to arrive as a command dialog inside whichever session happened to
 * be open, so it appeared once per session, left a receipt in that
 * transcript, and came back on the next session because closing it recorded
 * nothing. The owner's ruling: one popup, wherever you are, and closing it
 * answers it. The offer therefore belongs to the machine (the plugin's
 * server half writes pi-updater's own record) and to the shell's modal layer
 * (the host's dialog seam), not to a conversation.
 */


/** The offer's own shape, scoped to its class: the plugin has no shadow root
 *  here (the content is the host surface's light children), so every rule is
 *  namespaced rather than styling the shell's dialogs by accident. */
const OFFER_STYLES = `
  .pi-update-offer, .pi-update-notice { display: grid; gap: var(--pi-space-5); padding: var(--pi-space-6); color: var(--pi-text); }
  .pi-update-offer h2, .pi-update-notice h2 { margin: 0; font-size: var(--pi-text-lg); }
  .pi-update-offer p, .pi-update-notice p { margin: 0; color: var(--pi-muted); }
  .pi-update-notice p.error { color: var(--pi-danger); overflow-wrap: anywhere; }
  .pi-update-offer header { display: grid; gap: var(--pi-space-2); }
  .pi-update-offer footer, .pi-update-notice footer { display: flex; justify-content: flex-end; gap: var(--pi-space-3); }
  .pi-update-offer button, .pi-update-notice button { box-sizing: border-box; min-height: var(--pi-control-height); padding: 0 var(--pi-space-5); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); font: inherit; cursor: pointer; }
  .pi-update-offer button.primary, .pi-update-notice button.primary { border-color: var(--pi-accent); background: var(--pi-accent); color: var(--pi-on-accent, var(--pi-bg)); }
  @media (pointer: coarse) { .pi-update-offer button, .pi-update-notice button { min-height: var(--pi-control-height-touch); } }
`;

export interface PiWebUpdateOfferFacts {
  running: string;
  latest: string;
  /** The machine's own update command; it restarts the very processes that
   *  would run it, so it is handed to the reader rather than executed here. */
  command: string | undefined;
}

export interface PiWebUpdateDialogPorts {
  ui: Pick<PluginHostUi, "showDialog">;
  html: HtmlTemplateTag;
  /** Records the answer machine-wide; the offer never returns for this version. */
  answer: (version: string) => Promise<void>;
  /** Hands the command to the reader; resolves false when it could not copy. */
  copy: (command: string) => Promise<boolean>;
  notify: (message: string, kind: "info" | "error") => void;
}

export function showPiWebUpdateOffer(facts: PiWebUpdateOfferFacts, ports: PiWebUpdateDialogPorts): void {
  const { html } = ports;
  let answered = false;
  const record = () => {
    if (answered) return;
    answered = true;
    void ports.answer(facts.latest).catch(() => {
      ports.notify("This machine could not record the update answer, so the offer may return.", "error");
    });
  };

  const handle = ports.ui.showDialog({
    label: `Update PI WEB ${facts.running} to ${facts.latest}`,
    onClose: () => { record(); },
    content: html`
      <style>${OFFER_STYLES}</style>
      <section class="pi-update-offer">
        <header>
          <h2>Update PI WEB</h2>
          <p>${facts.running} → ${facts.latest} on this machine. PI WEB carries the pi agent your sessions run, so this is the update that changes both.</p>
          <p>The update restarts the web process and the session daemon, so it runs in a terminal rather than from this page.</p>
        </header>
        <footer>
          ${facts.command === undefined ? null : html`<button
            type="button"
            class="primary"
            @click=${() => {
              record();
              handle.close();
              void ports.copy(facts.command ?? "")
                .then((copied) => {
                  ports.notify(
                    copied
                      ? "Update command copied. Run it in a terminal on this machine."
                      : "This browser would not let the page copy; the command is in the Updates panel.",
                    copied ? "info" : "error",
                  );
                })
                .catch(() => { ports.notify("The command could not be copied; it is in the Updates panel.", "error"); });
            }}
          >Copy update command</button>`}
          <button type="button" @click=${() => { record(); handle.close(); }}>Not this version</button>
        </footer>
      </section>
    `,
  });
}

/** What the machine reported after an update attempt, as its own small dialog:
 *  a plugin has no banner of its own, and silence after pressing Update is
 *  what made the action feel fake. */
export function showPiWebUpdateNotice(
  html: HtmlTemplateTag,
  ui: Pick<PluginHostUi, "showDialog">,
  message: string,
  kind: "info" | "error",
): void {
  const handle = ui.showDialog({
    label: kind === "error" ? "Update failed" : "Update",
    content: html`
      <style>${OFFER_STYLES}</style>
      <section class="pi-update-notice">
        <p class=${kind === "error" ? "error" : ""}>${message}</p>
        <footer><button type="button" class="primary" @click=${() => { handle.close(); }}>OK</button></footer>
      </section>
    `,
  });
}
