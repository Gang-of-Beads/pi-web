import type { TemplateResult } from "lit";
import { answeredVersionsFrom, piWebOfferFacts, piWebUpdateOffer } from "./piWebUpdateOffer.js";
import { showPiWebUpdateNotice, showPiWebUpdateOffer } from "./updateOfferDialog.js";
import type { GlobalPanelContext, GlobalPanelTerminal, HtmlTemplateTag, PiWebPlugin, PluginActivationContext, PluginHostUi } from "@gang-of-beads/pi-web/plugin-api";
import { fallbackDockerStatus, messageCount, shouldShowUpdatesPanel, statusFor, type UpdatesRuntimeHint } from "./updatesLogic.js";
import { updatesPageModel, type ClockTime, type RestartTarget, type UpdatesPageActions } from "./updatesPage.js";

/** Run an update command in a new shell in the machine's home folder, shown on the global Terminal page. */
function runCommandInTerminal(terminal: GlobalPanelTerminal, label: string, command: string): void {
  void terminal.runInNewTerminal({ title: label, command }).catch((error: unknown) => {
    console.error(`Updates plugin failed to run "${label}"`, error);
  });
}

function updatesRuntimeHintFromModuleUrl(moduleUrl: string): UpdatesRuntimeHint {
  try {
    const dockerMode = new URL(moduleUrl).searchParams.get("dockerMode");
    return dockerMode === "runtime" || dockerMode === "dev" ? { dockerMode } : {};
  } catch {
    return {};
  }
}

const runtimeHint = updatesRuntimeHintFromModuleUrl(import.meta.url);

const dayNumber = (date: Date): number => date.getFullYear() * 10_000 + date.getMonth() * 100 + date.getDate();

/** A time of day when it is today, else the date with it: a release check is cached for hours and a run may be yesterday's. */
const localClockTime: ClockTime = (iso) => {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return undefined;
  const at = new Date(time);
  return dayNumber(at) === dayNumber(new Date())
    ? at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : at.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

/** What each restart asks before it runs: both take the page's connection down for a moment, and the daemon's stops running sessions. */
const RESTART_CONFIRM: Readonly<Record<RestartTarget, { readonly title: string; readonly message: string; readonly terminalTitle: string }>> = {
  web: { title: "Restart the web server?", message: "This page loses its connection for a moment and reconnects when the server is back.", terminalTitle: "Restart web" },
  sessiond: { title: "Restart the session daemon?", message: "Sessions running on this machine stop while the daemon restarts.", terminalTitle: "Restart session daemon" },
};

/**
 * The page's buttons. A check marks its machine as checking until the host answers; an update or
 * restart asks on the app's own dialog and then starts in a terminal the reader can follow. A host
 * without a dialog gets no restart or update buttons rather than ones that skip the question.
 */
function pageActions(context: GlobalPanelContext, ui: PluginHostUi | undefined, checking: Set<string>): UpdatesPageActions {
  const machineId = context.machine.id;
  const check = context.checkForPiWebUpdates;
  const confirm = ui?.confirm;
  const ask = (title: string, message: string, confirmLabel: string, then: () => void): void => {
    if (confirm === undefined) return;
    void confirm({ title, message, confirmLabel }).then((confirmed) => { if (confirmed) then(); });
  };
  return {
    checking: checking.has(machineId),
    check: check === undefined ? undefined : () => {
      checking.add(machineId);
      context.host.requestRender();
      void check().catch(() => undefined).finally(() => {
        checking.delete(machineId);
        context.host.requestRender();
      });
    },
    update: confirm === undefined ? undefined : (command, version) => {
      ask(`Update PI WEB to ${version}?`, "The update restarts PI WEB when it finishes; sessions running on this machine stop while it restarts.", "Update", () => {
        runCommandInTerminal(context.terminal, `Update PI WEB to ${version}`, command);
      });
    },
    restart: confirm === undefined ? undefined : (target, command) => {
      const words = RESTART_CONFIRM[target];
      ask(words.title, words.message, "Restart", () => { runCommandInTerminal(context.terminal, words.terminalTitle, command); });
    },
  };
}

function renderUpdatesPanel(html: HtmlTemplateTag, ui: PluginHostUi | undefined, context: GlobalPanelContext, checking: Set<string>): TemplateResult {
  if (ui?.renderList === undefined) return html`<p class="muted">This page needs a newer PI WEB on this device.</p>`;
  const status = statusFor(context.state) ?? fallbackDockerStatus(runtimeHint);
  return ui.renderList(updatesPageModel(status, pageActions(context, ui, checking), localClockTime));
}

/**
 * The machine's PI WEB update offer, once.
 *
 * PI WEB carries the pi agent its sessions run - not the pi on the machine's
 * PATH - so this is the update that matters, and it is the plugin's own
 * business: the decision, the machine-owned record of answered versions and
 * the popup all live here, and the shell only lends its modal layer. The
 * plugin is machine-specific, so one activation is one machine.
 *
 * The command restarts the web process and the session daemon, so it is handed
 * to the reader instead of executed from the page that would die running it.
 */
function offerPiWebUpdate(context: PluginActivationContext): void {
  const { callOperation, fetchJson, ui } = context;
  if (callOperation === undefined || fetchJson === undefined || ui === undefined) return;
  const status = context.readPiWebStatus?.() ?? fetchJson("api/pi-web/status");
  void Promise.all([status, callOperation("offer.answered")])
    .then(([status, answered]) => {
      const facts = piWebOfferFacts(status);
      const verdict = piWebUpdateOffer({ running: facts.running, release: facts.release, answeredVersions: answeredVersionsFrom(answered) });
      if (verdict.kind !== "offer") return;
      showPiWebUpdateOffer({ running: verdict.running, latest: verdict.latest, command: facts.command }, {
        ui,
        html: context.html,
        answer: async (version) => { await callOperation("offer.answer", { version }); },
        copy: (value) => ui.copyText(value),
        notify: (message, kind) => { showPiWebUpdateNotice(context.html, ui, message, kind); },
      });
    })
    .catch(() => {
      // A machine that cannot be asked is not a machine without updates: no
      // offer is shown, and the next activation asks again.
    });
}

const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Updates",
  activate: (context) => {
    const { html, svg, ui } = context;
    const checking = new Set<string>();
    offerPiWebUpdate(context);
    return {
    contributions: {
      actions: [
        {
          id: "check",
          title: "Check for PI WEB Updates",
          description: "Bypass cached release data and check the selected machine now",
          group: "Updates",
          enabled: (context) => context.checkForPiWebUpdates !== undefined,
          disabledReason: () => "Update checks require a newer PI WEB gateway",
          run: (context) => context.checkForPiWebUpdates?.(),
        },
      ],
      globalPanels: [
        {
          id: "global.updates",
          title: "Updates",
          routeAliases: ["updates:workspace.updates"],
          icon: svg`
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 6v5h-5"></path>
              <path d="M4 18v-5h5"></path>
              <path d="M18.4 9A7 7 0 0 0 6.1 6.7L4 8.8"></path>
              <path d="M5.6 15A7 7 0 0 0 17.9 17.3L20 15.2"></path>
            </svg>
          `,
          order: 100,
          visible: (context) => shouldShowUpdatesPanel(context.state, runtimeHint),
          badge: (context) => {
            const count = messageCount(context.state);
            return count > 0 ? count : undefined;
          },
          render: (context) => renderUpdatesPanel(html, ui, context, checking),
        },
      ],
    },
    };
  },
};

export default plugin;
