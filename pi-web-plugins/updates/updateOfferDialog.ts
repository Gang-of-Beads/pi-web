import { html, render } from "lit";
import type { HtmlTemplateTag, PluginHostUi } from "@gang-of-beads/pi-web/plugin-api";
import { packageNaming, packageRestartNotes, packageVersions } from "./piPackageRows.js";
import type { PackageUpdateOutcome, PiPackageUpdater } from "./piPackageUpdater.js";
import { offerAnswerWrites, REMIND_DELAY_ORDER, REMIND_DELAYS, type OfferAnswerWrites, type PiPackageUpdateFact, type UpdatesOfferAnswer, type UpdatesOfferLines } from "./updatesOffer.js";

/**
 * The "Updates on <machine>" pop-up: PI WEB's own update and the pi package updates in one
 * host-level dialog (owner, 2026-10-21).
 *
 * It used to be a PI WEB offer alone, arriving inside whichever session was open, once per session.
 * It is now one dialog over the shell's modal layer, wherever the reader is, and the machine
 * remembers the answer (the plugin's server half). Each line has its own Update and the dialog has
 * Update all; how the reader leaves it - the close key, "Remind me in" one of three delays, "Don't
 * remind me about these versions" - is recorded through `OFFER_ANSWER_RECORDS`.
 *
 * The look is the Updates page in small (owner, 2026-10-21, option C): a header with the close
 * key, a "PI WEB" group and a "Pi packages" group of rows, each row ending in its key or, once the
 * key was pressed, its result; the footer acts first and leaves second.
 *
 * The dialog redraws its own content as package updates progress: the host draws a plugin
 * dialog's content once, so the lines live in an element this module renders into. Its middle
 * scrolls between the header and the footer, since the host's dialog surface clips what does not
 * fit, and a phone fits little.
 */

/** The offer's own shape, scoped to its class: the plugin has no shadow root
 *  here (the content is the host surface's light children), so every rule is
 *  namespaced rather than styling the shell's dialogs by accident. Keys draw
 *  36px and reach 44px on a coarse pointer, as the app's bar keys do. */
const OFFER_STYLES = `
  .pi-update-offer { display: flex; flex-direction: column; min-height: 0; color: var(--pi-text); line-height: 1.4; }
  .pi-update-offer > header { display: flex; align-items: center; justify-content: space-between; gap: var(--pi-space-4); padding: var(--pi-space-4) var(--pi-space-4) var(--pi-space-4) var(--pi-space-6); border-bottom: 1px solid var(--pi-border); }
  .pi-update-offer h2 { margin: 0; font-size: var(--pi-text-lg); font-weight: var(--pi-weight-semibold); overflow-wrap: anywhere; }
  .pi-update-offer .offer-body { display: grid; gap: var(--pi-space-6); min-height: 0; padding: var(--pi-space-5) var(--pi-space-6) var(--pi-space-6); overflow-y: auto; overscroll-behavior: contain; }
  .pi-update-offer .offer-section { display: grid; gap: var(--pi-space-3); min-width: 0; }
  .pi-update-offer h3 { margin: 0 var(--pi-space-2); color: var(--pi-muted); font-size: var(--pi-text-xs); font-weight: var(--pi-weight-semibold); }
  .pi-update-offer h3 .count { color: var(--pi-dim); font-weight: var(--pi-weight-regular); }
  .pi-update-offer ul { margin: 0; padding: 0; list-style: none; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); overflow: hidden; }
  .pi-update-offer ul > li + li { border-top: 1px solid var(--pi-border-muted); }
  .pi-update-offer .line { box-sizing: border-box; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--pi-space-1) var(--pi-space-5); min-height: var(--pi-control-height-touch); padding: var(--pi-space-4) var(--pi-space-5); }
  .pi-update-offer .line > :not(.end) { grid-column: 1; min-width: 0; overflow-wrap: anywhere; }
  .pi-update-offer .line .title { font-weight: var(--pi-weight-semibold); }
  .pi-update-offer .line .detail { color: var(--pi-dim); font-size: var(--pi-text-xs); font-variant-numeric: tabular-nums; }
  .pi-update-offer .line .detail .versions { color: var(--pi-text-secondary); }
  .pi-update-offer .line .say { color: var(--pi-muted); font-size: var(--pi-text-xs); }
  .pi-update-offer .line > .why { grid-column: 1 / -1; color: var(--pi-danger); font-size: var(--pi-text-xs); }
  .pi-update-offer .line > .end { grid-column: 2; grid-row: 1 / span 2; display: flex; align-items: center; gap: var(--pi-space-4); justify-self: end; }
  .pi-update-offer .line > .end.result { grid-row: 1; }
  .pi-update-offer .status { display: inline-flex; align-items: center; gap: var(--pi-space-3); font-size: var(--pi-text-xs); white-space: nowrap; }
  .pi-update-offer .status::before { content: ""; width: var(--pi-dot-sm); height: var(--pi-dot-sm); border-radius: 50%; background: currentColor; }
  .pi-update-offer .status.good { color: var(--pi-success); }
  .pi-update-offer .status.problem { color: var(--pi-danger); }
  .pi-update-offer .more { padding: var(--pi-space-4) var(--pi-space-5); color: var(--pi-dim); font-size: var(--pi-text-xs); }
  .pi-update-offer .notes { display: grid; gap: var(--pi-space-2); padding: var(--pi-space-4) var(--pi-space-5); background: var(--pi-surface-canvas); color: var(--pi-muted); font-size: var(--pi-text-xs); }
  .pi-update-offer > footer { display: grid; gap: var(--pi-space-4); padding: var(--pi-space-5) var(--pi-space-6) var(--pi-space-6); border-top: 1px solid var(--pi-border); }
  .pi-update-offer .later { display: grid; grid-template-columns: auto 1fr 1fr 1fr; align-items: center; gap: var(--pi-space-3); }
  .pi-update-offer .later > span { margin-inline-end: var(--pi-space-2); color: var(--pi-muted); font-size: var(--pi-text-xs); }
  .pi-update-notice { display: grid; gap: var(--pi-space-5); padding: var(--pi-space-6); color: var(--pi-text); }
  .pi-update-notice p { margin: 0; color: var(--pi-muted); }
  .pi-update-notice p.error { color: var(--pi-danger); overflow-wrap: anywhere; }
  .pi-update-notice footer { display: flex; justify-content: flex-end; }
  .pi-update-offer button, .pi-update-notice button { position: relative; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; min-height: var(--pi-control-height-comfort); padding: 0 var(--pi-space-6); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface-raised); color: var(--pi-text); font: var(--pi-text-sm) var(--pi-font-ui); cursor: pointer; }
  .pi-update-offer button:disabled { cursor: default; opacity: var(--pi-disabled-opacity); }
  .pi-update-offer button[aria-busy="true"] { opacity: 1; color: var(--pi-muted); padding-inline-start: calc(2 * var(--pi-space-6)); cursor: progress; }
  .pi-update-offer button[aria-busy="true"]::before { content: ""; position: absolute; inset-inline-start: var(--pi-space-4); top: calc(50% - var(--pi-dot-md) / 2); box-sizing: border-box; width: var(--pi-dot-md); height: var(--pi-dot-md); border: 2px solid color-mix(in srgb, var(--pi-accent) 25%, transparent); border-top-color: var(--pi-accent); border-radius: 50%; animation: pi-update-offer-spin 0.8s linear infinite; }
  .pi-update-offer button.quiet { background: var(--pi-surface); }
  .pi-update-offer button.wide { width: 100%; }
  .pi-update-offer button.filled, .pi-update-notice button.filled { border-color: var(--pi-accent); background: var(--pi-accent); color: var(--pi-on-accent); font-weight: var(--pi-weight-semibold); }
  .pi-update-offer button.key { flex: 0 0 auto; width: var(--pi-control-height-comfort); padding: 0; background: var(--pi-surface); }
  .pi-update-offer button.key > svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
  .pi-update-offer button:focus-visible, .pi-update-notice button:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-tight); }
  @keyframes pi-update-offer-spin { to { transform: rotate(360deg); } }
  @media (pointer: coarse) {
    .pi-update-offer button::after, .pi-update-notice button::after { content: ""; position: absolute; inset: calc((var(--pi-control-height-comfort) - var(--pi-control-height-touch)) / 2 - 1px) -1px; }
    .pi-update-offer button.key::after { inset: calc((var(--pi-control-height-comfort) - var(--pi-control-height-touch)) / 2 - 1px); }
  }
`;

const SHOWN_PACKAGE_LINES = 5;

/** The package lines drawn: every line an update has touched, so its result is seen, then idle lines while there is room. */
function shownPackageLines(packages: readonly PiPackageUpdateFact[], updater: PiPackageUpdater | undefined): PiPackageUpdateFact[] {
  const touched = (update: PiPackageUpdateFact): boolean => updater?.outcome(update) !== undefined;
  let idleRoom = SHOWN_PACKAGE_LINES - packages.filter(touched).length;
  return packages.filter((update) => {
    if (touched(update)) return true;
    idleRoom -= 1;
    return idleRoom >= 0;
  });
}

/** What the PI WEB line offers: its Update (confirm, then the page runs it in a terminal), or the Updates page. */
export type PiWebLineAction =
  | { readonly kind: "update"; readonly run: (closeDialog: () => void) => Promise<void> }
  | { readonly kind: "open-updates"; readonly run: (closeDialog: () => void) => void };

export interface UpdatesOfferDialogPorts {
  readonly ui: Pick<PluginHostUi, "showDialog" | "renderCloseIcon">;
  readonly machineName: string;
  /** Runs the package lines' updates; absent when this host cannot call the machine. */
  readonly updater: PiPackageUpdater | undefined;
  readonly piWebAction: PiWebLineAction | undefined;
  /** Why the machine's services offer no restart (`servicesRestartNote`); the PI WEB line says it in place of the restart. */
  readonly restartNote: string | undefined;
  /** Records the reader's answer machine-wide. */
  readonly record: (writes: OfferAnswerWrites) => Promise<void>;
  readonly notify: (message: string, kind: "info" | "error") => void;
  readonly now: () => number;
}

const PI_WEB_LINE_SAYS = "Restarts the web process and the session daemon, so it runs in a terminal you can follow.";

/**
 * What the PI WEB line says about the services: with an Update key, that the update restarts them
 * (the update is this PI WEB's own, so it restarts what runs it); without one, where the services
 * offer no restart, the Updates page's note; else nothing, since the key only opens the page.
 */
function piWebLineSays(restartNote: string | undefined, action: PiWebLineAction | undefined): string | undefined {
  return action?.kind === "update" ? PI_WEB_LINE_SAYS : restartNote;
}

/** The close mark for a host older than `renderCloseIcon`. */
const CROSS = html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>`;

/** A package line's end: its Update key, the busy key while it runs, or its result in place of the key; a failed update keeps the key, to try again. */
type LineEnd = "update" | "updating" | "updated" | "failed" | "none";

function lineEnd(outcome: PackageUpdateOutcome | undefined, canUpdate: boolean): LineEnd {
  if (outcome?.kind === "updated") return "updated";
  if (!canUpdate) return "none";
  if (outcome?.kind === "updating") return "updating";
  return outcome?.kind === "failed" ? "failed" : "update";
}

export function showUpdatesOffer(lines: UpdatesOfferLines, ports: UpdatesOfferDialogPorts): void {
  const { updater, piWebAction } = ports;
  const container = document.createElement("div");
  container.className = "pi-update-offer";
  let answered = false;
  const answer = (chosen: UpdatesOfferAnswer): void => {
    if (answered) return;
    answered = true;
    void ports.record(offerAnswerWrites(lines, chosen, ports.now())).catch(() => {
      ports.notify("This machine could not record the answer, so the offer may return.", "error");
    });
  };
  let unsubscribe: () => void = () => undefined;
  const handle = ports.ui.showDialog({
    label: `Updates on ${ports.machineName}`,
    presentation: "alert",
    onClose: () => {
      unsubscribe();
      answer({ kind: "close" });
    },
    content: html`<style>${OFFER_STYLES}</style>${container}`,
  });
  const close = (): void => { handle.close(); };
  const leave = (chosen: UpdatesOfferAnswer): void => {
    answer(chosen);
    close();
  };

  const updateKey = (update: PiPackageUpdateFact) => html`<button type="button" ?disabled=${updater?.busy() ?? true} @click=${() => { void updater?.update(update); }}>Update</button>`;
  const LINE_END: Readonly<Record<LineEnd, (update: PiPackageUpdateFact) => unknown>> = {
    update: (update) => html`<span class="end">${updateKey(update)}</span>`,
    updating: () => html`<span class="end"><button type="button" disabled aria-busy="true">Updating…</button></span>`,
    updated: () => html`<span class="end result"><span class="status good">updated</span></span>`,
    failed: (update) => html`<span class="end"><span class="status problem">failed</span>${updateKey(update)}</span>`,
    none: () => null,
  };

  const packageLine = (update: PiPackageUpdateFact) => {
    const outcome = updater?.outcome(update);
    const naming = packageNaming(update);
    return html`<li class="line">
      <span class="title">${naming.name}</span>
      <span class="detail"><span class="versions">${packageVersions(update)}</span> · ${naming.origin}</span>
      ${LINE_END[lineEnd(outcome, updater !== undefined)](update)}
      ${outcome?.kind === "failed" ? html`<span class="why">${outcome.error}</span>` : null}
    </li>`;
  };

  const piWebKey = () => {
    const action = piWebAction;
    if (action?.kind === "update") return html`<span class="end"><button type="button" ?disabled=${updater?.busy() ?? false} @click=${() => { void action.run(close); }}>Update</button></span>`;
    if (action?.kind === "open-updates") return html`<span class="end"><button type="button" ?disabled=${updater?.busy() ?? false} @click=${() => { action.run(close); }}>Open Updates</button></span>`;
    return null;
  };

  const piWebSection = () => {
    const piWeb = lines.piWeb;
    if (piWeb === undefined) return null;
    const says = piWebLineSays(ports.restartNote, piWebAction);
    return html`<section class="offer-section">
      <h3>PI WEB</h3>
      <ul><li class="line">
        <span class="title">PI WEB ${piWeb.latest}</span>
        <span class="detail">running ${piWeb.running}</span>
        ${piWebKey()}
        ${says === undefined ? null : html`<span class="say">${says}</span>`}
      </li></ul>
    </section>`;
  };

  const packagesSection = () => {
    if (lines.packages.length === 0) return null;
    const shown = shownPackageLines(lines.packages, updater);
    const hidden = lines.packages.length - shown.length;
    const notes = packageRestartNotes(lines.packages, updater);
    return html`<section class="offer-section">
      <h3>Pi packages <span class="count">· ${String(lines.packages.length)}</span></h3>
      <ul>
        ${shown.map(packageLine)}
        ${hidden > 0 ? html`<li class="more">+${String(hidden)} more on the Updates page</li>` : null}
        ${notes.length === 0 ? null : html`<li class="notes">${notes.map((note) => html`<span>${note}</span>`)}</li>`}
      </ul>
    </section>`;
  };

  /**
   * Packages first, then PI WEB, whose update restarts the web process and would cut a package
   * update short: PI WEB is handed over only once every package line reads updated.
   *
   * The packages the reader asked for keep updating after the dialog is left. Leaving used to stop
   * the run at its next step, so closing the pop-up during "Update all (3)" updated the one package
   * already under way and none after it (owner, 2026-10-29). They run on the machine's updater,
   * which the Updates page shares, so their progress and outcomes show there. PI WEB's own update
   * is still not handed over once the dialog is gone: it asks first and opens the Updates page,
   * which only the reader in front of the dialog should see.
   */
  const updateAll = async (): Promise<void> => {
    const pending = lines.packages.filter((update) => updater?.outcome(update)?.kind !== "updated");
    if (pending.length > 0) {
      if (updater === undefined) return;
      await updater.updateAll(pending);
    }
    if (answered || piWebAction?.kind !== "update") return;
    if (lines.packages.some((update) => updater?.outcome(update)?.kind !== "updated")) return;
    await piWebAction.run(close);
  };

  const draw = (): void => {
    const updatable = (updater === undefined ? 0 : lines.packages.filter((update) => updater.outcome(update)?.kind !== "updated").length) + (piWebAction?.kind === "update" ? 1 : 0);
    render(html`
      <header>
        <h2>Updates on ${ports.machineName}</h2>
        <button type="button" class="key" aria-label="Close" @click=${close}>${ports.ui.renderCloseIcon?.() ?? CROSS}</button>
      </header>
      <div class="offer-body">${piWebSection()}${packagesSection()}</div>
      <footer>
        ${updatable > 1 ? html`<button type="button" class="filled wide" ?disabled=${updater?.busy() ?? false} @click=${() => { void updateAll(); }}>Update all (${String(updatable)})</button>` : null}
        <div class="later" role="group" aria-labelledby="pi-update-offer-later">
          <span id="pi-update-offer-later">Remind me in</span>
          ${REMIND_DELAY_ORDER.map((delay) => html`<button type="button" class="quiet" @click=${() => { leave({ kind: "remind-later", delay }); }}>${REMIND_DELAYS[delay].label}</button>`)}
        </div>
        <button type="button" class="quiet wide" @click=${() => { leave({ kind: "dont-remind" }); }}>Don't remind me about these versions</button>
      </footer>
    `, container);
  };
  unsubscribe = updater?.onChange(draw) ?? unsubscribe;
  draw();
}

/** What the machine reported after an update attempt, as its own small dialog:
 *  a plugin has no banner of its own, and silence after pressing Update is
 *  what made the action feel fake. */
export function showPiWebUpdateNotice(
  htmlTag: HtmlTemplateTag,
  ui: Pick<PluginHostUi, "showDialog">,
  message: string,
  kind: "info" | "error",
): void {
  const handle = ui.showDialog({
    label: kind === "error" ? "Update failed" : "Update",
    content: htmlTag`
      <style>${OFFER_STYLES}</style>
      <section class="pi-update-notice">
        <p class=${kind === "error" ? "error" : ""}>${message}</p>
        <footer><button type="button" class="filled" @click=${() => { handle.close(); }}>OK</button></footer>
      </section>
    `,
  });
}
