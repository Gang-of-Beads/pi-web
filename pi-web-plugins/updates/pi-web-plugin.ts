import type { TemplateResult } from "lit";
import { answeredVersionsFrom, piWebOfferFacts, piWebUpdateOffer, updateCommandOf } from "./piWebUpdateOffer.js";
import { createPiPackageUpdater, type PiPackageUpdater } from "./piPackageUpdater.js";
import { showPiWebUpdateNotice, showUpdatesOffer, type PiWebLineAction } from "./updateOfferDialog.js";
import { piPackagesFrom, piWebOnlyOfferMemory, updatesOffer, updatesOfferMemoryFrom, type UpdatesOfferMemory } from "./updatesOffer.js";
import type { GlobalPanelContext, GlobalPanelTerminal, HtmlTemplateTag, PiWebPlugin, PiWebStatusResponse, PluginActivationContext, PluginHostUi } from "@gang-of-beads/pi-web/plugin-api";
import { fallbackDockerStatus, messageCount, shouldShowUpdatesPanel, statusFor, type UpdatesRuntimeHint } from "./updatesLogic.js";
import { servicesRestartNote, updatesPageModel, type ClockTime, type RestartTarget, type UpdatesPageActions } from "./updatesPage.js";

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
 * The machine an activation belongs to. The context carries no machine, but the host names a
 * remote machine's copy of a plugin `machine.<hex of the machine id>.<plugin id>` in
 * `runtimePluginId` (`src/shared/machinePluginIds.ts`) and the gateway's own copy by its plain id.
 * This depends on that naming, the same way the Docker hint depends on the module URL's query.
 */
function machineIdFromRuntimePluginId(runtimePluginId: string): string {
  const hex = /^machine\.([0-9a-f]+)\./u.exec(runtimePluginId)?.[1];
  if (hex === undefined || hex.length % 2 !== 0) return "local";
  const bytes = Uint8Array.from(hex.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16));
  return new TextDecoder().decode(bytes);
}

const PI_WEB_UPDATE_HANDOFF_MS = 30_000;
const PI_WEB_UPDATE_WARNING = "The update restarts PI WEB when it finishes; sessions running on this machine stop while it restarts.";

/**
 * A PI WEB update the reader confirmed in the pop-up, for the Updates page to run.
 *
 * The pop-up opens where no terminal is lent, so its PI WEB Update confirms there and hands the run
 * to the page, which starts it in a terminal on its first render for this machine and version. The
 * intent is held in memory only - a reload or another tab never replays it - expires after 30 s,
 * and is consumed once; one that does not match is dropped and the page shows its own Update.
 */
interface PiWebUpdateIntent {
  readonly machineId: string;
  readonly version: string;
  readonly expiresAt: number;
}

type IntentVerdict = "run" | "wait" | "drop";

function piWebUpdateIntentVerdict(intent: PiWebUpdateIntent, machineId: string, status: PiWebStatusResponse | undefined, now: number): IntentVerdict {
  if (intent.expiresAt <= now || intent.machineId !== machineId) return "drop";
  if (status === undefined) return "wait";
  return status.release.updateAvailable && status.release.latestVersion === intent.version && updateCommandOf(status.commands) !== undefined ? "run" : "drop";
}

type PopupSave = { readonly kind: "settled" } | { readonly kind: "saving"; readonly enabled: boolean } | { readonly kind: "failed" };

/** One activation's state: one machine, since the plugin is machine-specific. */
interface UpdatesPluginState {
  readonly checking: Set<string>;
  readonly updaters: Map<string, PiPackageUpdater>;
  piWebUpdateIntent: PiWebUpdateIntent | undefined;
  /** The machine's pop-up switch for package lines as stored; undefined until `offer.read` answered. */
  packagesEnabled: boolean | undefined;
  /** The switch's last change: the choice being written, or the machine's refusal of it. */
  popupSave: PopupSave;
  /**
   * Counts the switch's writes as each starts and as each ends. An `offer.read` that overlapped a
   * write may carry the state from before it, so its switch value is not drawn.
   */
  popupWrites: number;
  rerenderPage: (() => void) | undefined;
  /** Hands the pop-up a status the page was drawn with; set once the activation can offer. */
  considerOffer: ((status: unknown) => void) | undefined;
}

function updaterFor(state: UpdatesPluginState, context: PluginActivationContext, machineId: string): PiPackageUpdater | undefined {
  const { fetchJson, ui } = context;
  if (fetchJson === undefined || ui === undefined) return undefined;
  const existing = state.updaters.get(machineId);
  if (existing !== undefined) return existing;
  const created = createPiPackageUpdater({ machineId, fetchJson, describeError: ui.describeError });
  created.onChange(() => { state.rerenderPage?.(); });
  state.updaters.set(machineId, created);
  return created;
}

/**
 * The page's buttons. A check marks its machine as checking until the host answers; an update or
 * restart asks on the app's own dialog and then starts in a terminal the reader can follow. A host
 * without a dialog gets no restart or update buttons rather than ones that skip the question.
 */
function pageActions(context: GlobalPanelContext, activation: PluginActivationContext, ui: PluginHostUi | undefined, state: UpdatesPluginState): UpdatesPageActions {
  const machineId = context.machine.id;
  const check = context.checkForPiWebUpdates;
  const confirm = ui?.confirm;
  const callOperation = activation.callOperation;
  const ask = (title: string, message: string, confirmLabel: string, then: () => void): void => {
    if (confirm === undefined) return;
    void confirm({ title, message, confirmLabel }).then((confirmed) => { if (confirmed) then(); });
  };
  return {
    checking: state.checking.has(machineId),
    check: check === undefined ? undefined : () => {
      state.checking.add(machineId);
      context.host.requestRender();
      void check().catch(() => undefined).finally(() => {
        state.checking.delete(machineId);
        context.host.requestRender();
      });
    },
    update: confirm === undefined ? undefined : (command, version) => {
      ask(`Update PI WEB to ${version}?`, PI_WEB_UPDATE_WARNING, "Update", () => {
        runCommandInTerminal(context.terminal, `Update PI WEB to ${version}`, command);
      });
    },
    setUpdateCommand: context.openUpdateCommandSetting,
    restart: confirm === undefined ? undefined : (target, command) => {
      const words = RESTART_CONFIRM[target];
      ask(words.title, words.message, "Restart", () => { runCommandInTerminal(context.terminal, words.terminalTitle, command); });
    },
    piPackages: {
      updater: updaterFor(state, activation, machineId),
      rowControls: ui?.renderToggle !== undefined,
      popupEnabled: state.popupSave.kind === "saving" ? state.popupSave.enabled : state.packagesEnabled,
      popupSave: state.popupSave.kind,
      togglePopup: callOperation === undefined || state.packagesEnabled === undefined ? undefined : (enabled) => {
        if (state.popupSave.kind === "saving") return;
        state.popupSave = { kind: "saving", enabled };
        state.popupWrites += 1;
        context.host.requestRender();
        void callOperation("offer.set-packages-enabled", { enabled }).then(() => {
          state.packagesEnabled = enabled;
          state.popupSave = { kind: "settled" };
        }, (error: unknown) => {
          console.error("Updates plugin could not change the pop-up switch", error);
          state.popupSave = { kind: "failed" };
        }).finally(() => {
          state.popupWrites += 1;
          state.rerenderPage?.();
        });
      },
    },
  };
}

/** Runs a PI WEB update the pop-up handed over, once, when it still matches what the page shows. */
function runHandedOverPiWebUpdate(context: GlobalPanelContext, status: PiWebStatusResponse | undefined, state: UpdatesPluginState): void {
  const intent = state.piWebUpdateIntent;
  if (intent === undefined) return;
  const verdict = piWebUpdateIntentVerdict(intent, context.machine.id, status, Date.now());
  if (verdict === "wait") return;
  state.piWebUpdateIntent = undefined;
  const command = updateCommandOf(status?.commands);
  if (verdict !== "run" || command === undefined) return;
  queueMicrotask(() => { runCommandInTerminal(context.terminal, `Update PI WEB to ${intent.version}`, command); });
}

function renderUpdatesPanel(html: HtmlTemplateTag, activation: PluginActivationContext, context: GlobalPanelContext, state: UpdatesPluginState): TemplateResult {
  const ui = activation.ui;
  if (ui?.renderList === undefined) return html`<p class="muted">This page needs a newer PI WEB on this device.</p>`;
  state.rerenderPage = () => { context.host.requestRender(); };
  const machineStatus = statusFor(context.state);
  runHandedOverPiWebUpdate(context, machineStatus, state);
  if (machineStatus !== undefined) state.considerOffer?.(machineStatus);
  const status = machineStatus ?? fallbackDockerStatus(runtimeHint);
  return ui.renderList(updatesPageModel(status, pageActions(context, activation, ui, state), localClockTime));
}

function machineName(context: PluginActivationContext, machineId: string): string {
  return context.fleet?.machines().machines.find((machine) => machine.id === machineId)?.name ?? "this machine";
}

/** The machine's offer memory, and its pop-up switch when known. */
interface OfferMemoryRead {
  readonly memory: UpdatesOfferMemory;
  readonly packagesEnabled: boolean | undefined;
}

/**
 * Reads what the machine remembers. A session daemon not restarted since `offer.read` arrived
 * still answers `offer.answered`, so the PI WEB line keeps its offer there and the switch stays
 * unknown.
 */
async function readOfferMemory(callOperation: (operation: string, input?: unknown) => Promise<unknown>): Promise<OfferMemoryRead> {
  try {
    const memory = updatesOfferMemoryFrom(await callOperation("offer.read"));
    return { memory, packagesEnabled: memory.packagesEnabled };
  } catch {
    return { memory: piWebOnlyOfferMemory(answeredVersionsFrom(await callOperation("offer.answered"))), packagesEnabled: undefined };
  }
}

const OFFER_REREADS = 3;
const OFFER_REREAD_MS = 31_000;

/**
 * The machine's "Updates on <machine>" pop-up, at most once per activation.
 *
 * PI WEB carries the pi agent its sessions run - not the pi on the machine's PATH - so its own
 * update is one line; the machine's pi packages with a newer version are the others. The decision,
 * the machine-owned memory of answers and the popup all live here, and the shell only lends its
 * modal layer. The plugin is machine-specific, so one activation is one machine.
 *
 * Until a dialog has shown, every new status is decided again: the one read at activation may
 * predate the machine's package check (a web process just started) or Check now. While a status
 * says the check runs, it is read again a few times, once each read can carry the answer.
 *
 * A package update runs inline through the machine's core route. The PI WEB update restarts the web
 * process and the session daemon, so it is confirmed here and handed to the Updates page, which
 * runs it in a terminal the reader can follow instead of from the page that would die running it.
 */
function offerUpdates(context: PluginActivationContext, state: UpdatesPluginState): () => void {
  const { callOperation, fetchJson, ui } = context;
  if (callOperation === undefined || fetchJson === undefined || ui === undefined) return () => undefined;
  const machineId = machineIdFromRuntimePluginId(context.runtimePluginId);
  const readStatus = (): Promise<unknown> => context.readPiWebStatus?.() ?? fetchJson("api/pi-web/status");
  let shown = false;
  let disposed = false;
  let considered: unknown;
  let rereads = 0;
  let rereadTimer: ReturnType<typeof setTimeout> | undefined;
  let decisions: Promise<void> = Promise.resolve();
  const settled = (): boolean => shown || disposed;

  const decide = async (status: unknown): Promise<void> => {
    if (settled()) return;
    const writes = state.popupWrites;
    const read = await readOfferMemory(callOperation);
    const current = state.popupWrites === writes && state.popupSave.kind !== "saving";
    if (current) {
      state.packagesEnabled = read.packagesEnabled;
      state.rerenderPage?.();
    }
    if (settled()) return;
    const memory = current || state.packagesEnabled === undefined ? read.memory : { ...read.memory, packagesEnabled: state.packagesEnabled };
    const facts = piWebOfferFacts(status);
    const piWeb = piWebUpdateOffer({ running: facts.running, release: facts.release, answeredVersions: memory.answeredVersions });
    const piPackages = piPackagesFrom(status);
    const verdict = updatesOffer({ piWeb, piPackages, memory, now: Date.now() });
    if (verdict.kind !== "offer") {
      if (piPackages?.checking === true && rereads < OFFER_REREADS && rereadTimer === undefined) {
        rereads += 1;
        rereadTimer = setTimeout(() => {
          rereadTimer = undefined;
          void readStatus().then(consider).catch(() => undefined);
        }, OFFER_REREAD_MS);
      }
      return;
    }
    shown = true;
    showUpdatesOffer(verdict, {
      ui,
      machineName: machineName(context, machineId),
      updater: updaterFor(state, context, machineId),
      piWebAction: verdict.piWeb === undefined ? undefined : piWebLineAction(context, ui, state, machineId, verdict.piWeb.latest, facts.updateCommand !== undefined),
      restartNote: servicesRestartNote(status),
      record: async (writes) => {
        await Promise.all([
          writes.remindAfter === undefined ? undefined : callOperation("offer.remind-later", { until: new Date(writes.remindAfter).toISOString() }),
          writes.piWebVersion === undefined ? undefined : callOperation("offer.answer", { version: writes.piWebVersion }),
          writes.packagePairs.length === 0 ? undefined : callOperation("offer.answer-packages", { pairs: writes.packagePairs }),
        ]);
      },
      notify: (message, kind) => { showPiWebUpdateNotice(context.html, ui, message, kind); },
      now: Date.now,
    });
  };

  /** A machine that cannot be asked is not a machine without updates: no offer is shown, and the next status asks again. */
  const consider = (status: unknown): void => {
    if (settled() || status === considered) return;
    considered = status;
    decisions = decisions.then(() => decide(status)).catch(() => undefined);
  };

  state.considerOffer = consider;
  void readStatus().then(consider).catch(() => undefined);
  return () => {
    disposed = true;
    state.considerOffer = undefined;
    clearTimeout(rereadTimer);
  };
}

function piWebLineAction(context: PluginActivationContext, ui: PluginHostUi, state: UpdatesPluginState, machineId: string, version: string, canUpdate: boolean): PiWebLineAction | undefined {
  const openPage = context.openPage;
  if (openPage === undefined) return undefined;
  const open = (): void => { openPage(`${context.runtimePluginId}:global.updates`); };
  const confirm = ui.confirm;
  if (!canUpdate || confirm === undefined) return { kind: "open-updates", run: (closeDialog) => { closeDialog(); open(); } };
  return {
    kind: "update",
    run: async (closeDialog) => {
      if (!(await confirm({ title: `Update PI WEB to ${version}?`, message: PI_WEB_UPDATE_WARNING, confirmLabel: "Update" }))) return;
      state.piWebUpdateIntent = { machineId, version, expiresAt: Date.now() + PI_WEB_UPDATE_HANDOFF_MS };
      closeDialog();
      open();
    },
  };
}

const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Updates",
  activate: (context) => {
    const { html, svg } = context;
    const state: UpdatesPluginState = { checking: new Set(), updaters: new Map(), piWebUpdateIntent: undefined, packagesEnabled: undefined, popupSave: { kind: "settled" }, popupWrites: 0, rerenderPage: undefined, considerOffer: undefined };
    const stopOffering = offerUpdates(context, state);
    return {
    dispose: stopOffering,
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
          render: (panelContext) => renderUpdatesPanel(html, context, panelContext, state),
        },
      ],
    },
    };
  },
};

export default plugin;
