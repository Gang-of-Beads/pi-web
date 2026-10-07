import type { PiWebComponentStatus, PiWebInstallationInfo, PiWebPackageManager, PiWebReleaseStatus, PiWebStatusMessage, PiWebStatusResponse, PiWebStatusSeverity, PluginListAction, PluginListModel, PluginListRow, PluginListTone } from "@gang-of-beads/pi-web/plugin-api";
import { formatVersion, installationLabel } from "./updatesLogic.js";

/**
 * The Updates page as the host draws it (owner, 2026-10-06: mockup
 * `updates.png`, "不建议直接在这里给用户命令让用户run").
 *
 * The page used to hand the reader shell commands to copy or run. It now says
 * what is installed and running, and every action is a button: the plugin
 * starts the command in a terminal the reader can follow, and the command's
 * text never reaches the page. Each row's state is named by one classifier and
 * drawn through one table, so an unhandled state fails to compile.
 */
export type RestartTarget = "web" | "sessiond";

export interface UpdatesPageActions {
  /** Check for a release now; absent when the host cannot. */
  readonly check: (() => void) | undefined;
  readonly checking: boolean;
  /** Start an update command; absent when this page cannot run commands. */
  readonly update: ((command: string, version: string) => void) | undefined;
  /** Start a restart command; absent when this page cannot run commands. */
  readonly restart: ((target: RestartTarget, command: string) => void) | undefined;
  /** Open the Settings field where the update command is saved; absent on older hosts. */
  readonly setUpdateCommand: (() => void) | undefined;
}

export type ClockTime = (iso: string) => string | undefined;

type RowBody = Omit<PluginListRow, "id" | "title">;

const detailOf = (detail: string | undefined): Pick<PluginListRow, "detail"> => detail === undefined || detail === "" ? {} : { detail };

type LatestState = "skipped" | "failed" | "newer" | "current" | "unknown";

function latestState(release: PiWebReleaseStatus): LatestState {
  if (release.skipped === true) return "skipped";
  if (release.error !== undefined) return "failed";
  if (release.latestVersion === undefined) return "unknown";
  return release.updateAvailable ? "newer" : "current";
}

const LATEST_ROW: Readonly<Record<LatestState, (release: PiWebReleaseStatus, checked: string | undefined) => RowBody>> = {
  skipped: () => ({ value: "not checked", detail: "This machine skips the release check." }),
  failed: (release, checked) => ({ status: { label: "check failed", tone: "problem" }, ...detailOf([release.error, checked].filter((part) => part !== undefined).join(" · ")) }),
  newer: (release, checked) => ({ status: { label: formatVersion(release.latestVersion), tone: "attention" }, ...detailOf(checked) }),
  current: (_release, checked) => ({ status: { label: "up to date", tone: "good" }, ...detailOf(checked) }),
  unknown: (_release, checked) => ({ value: "unknown", ...detailOf(checked) }),
};

const MANAGED_WORDS: Readonly<Record<PiWebPackageManager, { readonly withCommand: string; readonly withoutCommand: string }>> = {
  nix: { withCommand: "Updated by this machine's update command.", withoutCommand: "Managed by your nix configuration. Save an update command in Settings to update from here." },
};

function installedDetail(installation: PiWebInstallationInfo | undefined, hasUpdateCommand: boolean): string | undefined {
  const manager = installation?.manager;
  if (manager === undefined) return installation?.path;
  const words = MANAGED_WORDS[manager];
  return hasUpdateCommand ? words.withCommand : words.withoutCommand;
}

type ServiceState = "unavailable" | "stale" | "current";

function serviceState(component: PiWebComponentStatus): ServiceState {
  if (!component.available) return "unavailable";
  return component.stale ? "stale" : "current";
}

const SERVICE_ROW: Readonly<Record<ServiceState, (component: PiWebComponentStatus) => RowBody>> = {
  current: (component) => ({ status: { label: `running ${formatVersion(component.runtimeVersion)}`, tone: "good" } }),
  stale: (component) => ({ status: { label: "restart needed", tone: "attention" }, detail: `running ${formatVersion(component.runtimeVersion)} · installed ${formatVersion(component.installedVersion)}` }),
  unavailable: (component) => ({ status: { label: "unavailable", tone: "problem" }, ...detailOf(component.error) }),
};

function serviceRow(id: string, component: PiWebComponentStatus): PluginListRow {
  return { id, title: component.label, ...SERVICE_ROW[serviceState(component)](component) };
}

const RESTART_LABEL: Readonly<Record<RestartTarget, string>> = { web: "Restart web", sessiond: "Restart session daemon" };

function restartActions(status: PiWebStatusResponse, actions: UpdatesPageActions): PluginListAction[] {
  const restart = actions.restart;
  if (restart === undefined) return [];
  const commands: readonly (readonly [RestartTarget, string | undefined])[] = [["web", status.commands.restartWeb], ["sessiond", status.commands.restartSessiond]];
  return commands.flatMap(([target, command]) => command === undefined || command === ""
    ? []
    : [{ id: `restart-${target}`, label: RESTART_LABEL[target], run: () => { restart(target, command); } }]);
}

function updateAction(status: PiWebStatusResponse, actions: UpdatesPageActions): PluginListAction | undefined {
  const update = actions.update;
  const command = status.commands.update;
  const latest = status.release.latestVersion;
  if (update === undefined || !status.release.updateAvailable || command === undefined || command === "" || latest === undefined) return undefined;
  return { id: "update", label: `Update to ${latest}`, primary: true, run: () => { update(command, latest); } };
}

/** A managed install with no update command links to the Settings field that can hold one (owner, 2026-10-07). */
function setCommandAction(installation: PiWebInstallationInfo | undefined, hasUpdateCommand: boolean, actions: UpdatesPageActions): PluginListAction | undefined {
  const open = actions.setUpdateCommand;
  if (open === undefined || hasUpdateCommand || installation?.manager === undefined) return undefined;
  return { id: "set-command", label: "Set an update command", run: open };
}

function checkAction(actions: UpdatesPageActions): PluginListAction | undefined {
  const check = actions.check;
  return check === undefined ? undefined : { id: "check", label: actions.checking ? "Checking…" : "Check now", disabled: actions.checking, run: check };
}

/**
 * Status messages whose fact a row of this page already draws: an update
 * available is the Latest row, a restart needed or a daemon that did not
 * answer is its Services row. Every other message (the Docker fallback's, and
 * any the server adds later) gets a row of its own, so whatever the page's
 * badge counts is on the page, once. The message's command is never drawn.
 */
const DRAWN_BY_ROWS: ReadonlySet<string> = new Set(["update-available", "web-stale", "sessiond-stale", "sessiond-unavailable"]);

const SEVERITY_TONE: Readonly<Record<PiWebStatusSeverity, PluginListTone>> = { info: "neutral", warning: "attention", error: "problem" };

function messageRow(message: PiWebStatusMessage): PluginListRow {
  return { id: message.id, title: message.title, status: { label: message.severity, tone: SEVERITY_TONE[message.severity] }, ...detailOf(message.body) };
}

const PAGE_WORDS = {
  empty: "This machine reported nothing to update.",
  reading: "Checking PI WEB update status…",
  failed: "This machine did not say how PI WEB is installed.",
  stale: "Could not refresh - showing the last read.",
} as const;

const RUN_NOTE = "Updates and restarts open in a new terminal on the Terminal page, so you can follow them.";

export function updatesPageModel(status: PiWebStatusResponse | undefined, actions: UpdatesPageActions, clock: ClockTime): PluginListModel {
  if (status === undefined) return { read: "reading", groups: [], words: PAGE_WORDS };
  const release = status.release;
  const checkedAt = release.checkedAt === undefined ? undefined : clock(release.checkedAt);
  const checked = checkedAt === undefined ? undefined : `checked ${checkedAt}`;
  const web = status.components.web;
  const hasUpdateCommand = status.commands.update !== undefined && status.commands.update !== "";
  const restarts = restartActions(status, actions);
  const update = updateAction(status, actions);
  const piWeb = [checkAction(actions), update, setCommandAction(web.installation, hasUpdateCommand, actions)].filter((action) => action !== undefined);
  const runs = restarts.length > 0 || update !== undefined;
  return {
    read: "ready",
    words: PAGE_WORDS,
    groups: [
      { id: "messages", heading: "Messages", rows: status.messages.filter((message) => !DRAWN_BY_ROWS.has(message.id)).map(messageRow) },
      {
        id: "pi-web",
        heading: "PI WEB",
        rows: [
          { id: "version", title: "Version", value: formatVersion(web.runtimeVersion) },
          { id: "latest", title: "Latest", ...LATEST_ROW[latestState(release)](release, checked) },
          { id: "installed", title: "Installed from", value: installationLabel(web.installation), ...detailOf(installedDetail(web.installation, hasUpdateCommand)) },
        ],
        actions: piWeb,
      },
      {
        id: "services",
        heading: "Services",
        rows: [serviceRow("web", web), serviceRow("sessiond", status.components.sessiond)],
        actions: restarts,
      },
    ],
    notes: runs ? [RUN_NOTE] : [],
  };
}
