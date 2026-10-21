import type { PiWebStatusResponse, PluginButton, PluginListAction, PluginListGroup, PluginListRow } from "@gang-of-beads/pi-web/plugin-api";
import type { PackageUpdateOutcome, PiPackageUpdater } from "./piPackageUpdater.js";
import type { PiPackageUpdateFact } from "./updatesOffer.js";

/**
 * The Updates page's "Pi packages" group for the machine on screen.
 *
 * The group's state and each row's state are named by one classifier each and drawn through one
 * table each, as the rest of the page is. A status without a package block was not reported to
 * this page, which an older PI WEB on either end explains: that is said, never drawn as "no
 * updates", and a machine that could not list its packages says so in its own words.
 */

type PiPackages = PiWebStatusResponse["piPackages"];
type RowBody = Omit<PluginListRow, "id" | "title">;

export interface PiPackageGroupActions {
  /** Runs the updates; absent when this host cannot call the machine. */
  readonly updater: PiPackageUpdater | undefined;
  /** The machine's pop-up switch as the reader sees it, a choice being saved included; `undefined` while it is unknown. */
  readonly popupEnabled: boolean | undefined;
  readonly popupSave: PopupSwitchSave;
  readonly togglePopup: ((enabled: boolean) => void) | undefined;
  /** The host draws a row's own key and checkbox (they arrived with `ui.renderToggle`); an older host gets the group's buttons. */
  readonly rowControls: boolean;
}

/** Where the switch's last change stands: written, being written, or refused by the machine (the stored state is drawn again). */
export type PopupSwitchSave = "settled" | "saving" | "failed";

type GroupState = "unreported" | "skipped" | "no-profile" | "listing-failed" | "none-installed" | "listed";

type Listing = NonNullable<PiPackages>["listing"];

const LISTING_GROUP_STATE: Readonly<Record<Exclude<Listing, "listed">, GroupState>> = { skipped: "skipped", "no-profile": "no-profile", failed: "listing-failed" };

/** Every configured package is a row, one still waiting for its answer or unreadable here included, so an empty list means none is configured. */
function groupState(piPackages: PiPackages): GroupState {
  if (piPackages === undefined) return "unreported";
  if (piPackages.listing !== "listed") return LISTING_GROUP_STATE[piPackages.listing];
  return piPackages.packages.length > 0 || (piPackages.unreadable?.length ?? 0) > 0 ? "listed" : "none-installed";
}

const GROUP_ROW: Readonly<Record<Exclude<GroupState, "listed">, (piPackages: PiPackages) => PluginListRow>> = {
  unreported: () => ({ id: "unreported", title: "Pi package updates were not reported to this page.", detail: "A different PI WEB version, on this machine or on the one serving this page, reports them in a way this page cannot read." }),
  skipped: () => ({ id: "skipped", title: "This machine skips update checks." }),
  "no-profile": () => ({ id: "no-profile", title: "No active agent profile." }),
  "listing-failed": (piPackages) => ({ id: "listing-failed", title: "This machine could not list its pi packages.", ...(piPackages?.listingError === undefined ? {} : { detail: piPackages.listingError }) }),
  "none-installed": () => ({ id: "none-installed", title: "No pi packages installed for this machine's user." }),
};

type RowState = PiPackageUpdateFact["state"] | "updating" | "updated" | "update-failed";

const OUTCOME_ROW_STATE: Readonly<Record<PackageUpdateOutcome["kind"], RowState>> = { updating: "updating", updated: "updated", failed: "update-failed" };

/** An update's result outlasts the check that answers the new version as current, as long as the restart notes it brought are shown. */
function rowState(update: PiPackageUpdateFact, outcome: PackageUpdateOutcome | undefined): RowState {
  if (outcome?.kind === "updated") return "updated";
  return update.state === "newer" && outcome !== undefined ? OUTCOME_ROW_STATE[outcome.kind] : update.state;
}

/** A package as the reader names it: the short name, and where it comes from in place of the user scope every row shares. */
export interface PackageNaming {
  readonly name: string;
  readonly origin: string;
}

const lastSegment = (path: string): { readonly head: string; readonly tail: string } => {
  const trimmed = path.replace(/\/+$/u, "");
  const slash = trimmed.lastIndexOf("/");
  return slash < 0 ? { head: "", tail: trimmed } : { head: trimmed.slice(0, slash), tail: trimmed.slice(slash + 1) };
};

const PACKAGE_NAMING: Readonly<Record<PiPackageUpdateFact["kind"], (displayName: string) => PackageNaming>> = {
  npm: (displayName) => ({ name: displayName, origin: "npm" }),
  git: (displayName) => {
    const { head, tail } = lastSegment(displayName);
    return head === "" || tail === "" ? { name: displayName, origin: "git" } : { name: tail, origin: head };
  },
  local: (displayName) => {
    const { tail } = lastSegment(displayName);
    return { name: tail === "" ? displayName : tail, origin: displayName };
  },
};

export function packageNaming(update: PiPackageUpdateFact): PackageNaming {
  return PACKAGE_NAMING[update.kind](update.displayName);
}

export const packageVersions = (update: PiPackageUpdateFact): string => `${update.installed ?? "unknown"} → ${update.available ?? "unknown"}`;

const joined = (...parts: readonly (string | undefined)[]): string => parts.filter((part) => part !== undefined && part !== "").join(" · ");

/** Settled states read as muted values with no dot; a newer version is the attention dot and its versions; a failure is the problem dot, its reason in the detail. */
const ROW_BODY: Readonly<Record<RowState, (update: PiPackageUpdateFact, origin: string, outcome: PackageUpdateOutcome | undefined) => RowBody>> = {
  newer: (update, origin) => ({ status: { label: packageVersions(update), tone: "attention" }, detail: origin }),
  current: (update, origin) => ({ value: joined("up to date", update.installed), detail: origin }),
  checking: (update, origin) => ({ value: "checking…", detail: joined(origin, `installed ${update.installed ?? "unknown"}`) }),
  pinned: (update, origin) => ({ value: joined("pinned", update.installed), detail: origin }),
  local: (_update, origin) => ({ value: "local path", detail: joined(origin, "no version to compare") }),
  missing: (_update, origin) => ({ value: "not installed yet", detail: joined(origin, "pi installs it when a session starts") }),
  failed: (update, origin) => ({ status: { label: "check failed", tone: "problem" }, detail: joined(origin, update.error) }),
  updating: (update, origin) => ({ detail: joined(packageVersions(update), origin) }),
  updated: (update, origin, outcome) => ({ status: { label: "updated", tone: "good" }, detail: joined(outcome?.kind === "updated" ? `${outcome.from ?? "unknown"} → ${outcome.to ?? "unknown"}` : packageVersions(update), origin) }),
  "update-failed": (_update, origin, outcome) => ({ status: { label: "update failed", tone: "problem" }, detail: joined(origin, outcome?.kind === "failed" ? outcome.error : undefined) }),
};

/** The row's own key: Update on a newer version and after a failed update, the busy key while it runs; a result replaces it. */
const ROW_KEY: Readonly<Record<RowState, "update" | "updating" | "none">> = {
  newer: "update", "update-failed": "update", updating: "updating",
  current: "none", checking: "none", pinned: "none", local: "none", missing: "none", failed: "none", updated: "none",
};

function rowAction(state: RowState, update: PiPackageUpdateFact, updater: PiPackageUpdater | undefined): PluginButton | undefined {
  const key = ROW_KEY[state];
  if (updater === undefined || key === "none") return undefined;
  if (key === "updating") return { label: "Updating…", busy: true, run: () => undefined };
  return { label: "Update", disabled: updater.busy(), run: () => { void updater.update(update); } };
}

function piPackageRow(update: PiPackageUpdateFact, actions: PiPackageGroupActions): PluginListRow {
  const outcome = actions.updater?.outcome(update);
  const state = rowState(update, outcome);
  const naming = packageNaming(update);
  const body = ROW_BODY[state](update, naming.origin, outcome);
  const row: PluginListRow = { id: `package:${update.source}`, title: naming.name, ...body };
  if (!actions.rowControls) return state === "updating" ? { ...row, status: { label: "updating…", tone: "neutral" } } : row;
  const action = rowAction(state, update, actions.updater);
  return action === undefined ? row : { ...row, action };
}

/** An entry this page could not read, such as a state a newer machine adds: still a package, never left out. */
function unreadableRow(name: string, index: number): PluginListRow {
  return { id: `unreadable:${String(index)}`, title: name, value: "unknown", detail: "This page cannot read its state." };
}

/** The newer packages not yet updated here: what the Update keys and "Update all" act on. */
function pendingPackageUpdates(packages: readonly PiPackageUpdateFact[], updater: PiPackageUpdater | undefined): PiPackageUpdateFact[] {
  return packages.filter((update) => update.state === "newer" && updater?.outcome(update)?.kind !== "updated");
}

function updateAllAction(pending: readonly PiPackageUpdateFact[], updater: PiPackageUpdater | undefined): PluginListAction | undefined {
  if (updater === undefined || pending.length < 2) return undefined;
  return { id: "update-all", label: `Update all (${String(pending.length)})`, primary: true, disabled: updater.busy(), run: () => { void updater.updateAll(pending); } };
}

const UPDATE_ALL_FIRST_ABOVE = 4;

/** An older host draws no row keys: one "Update <name>" button per newer package in the group's last row, with "Update all". */
function fallbackUpdateActions(pending: readonly PiPackageUpdateFact[], updater: PiPackageUpdater | undefined): PluginListAction[] {
  if (updater === undefined) return [];
  const busy = updater.busy();
  const each = pending.map((update): PluginListAction => ({
    id: `update:${update.source}`,
    label: `Update ${packageNaming(update).name}`,
    busy: updater.outcome(update)?.kind === "updating",
    disabled: busy,
    run: () => { void updater.update(update); },
  }));
  const all = updateAllAction(pending, updater);
  if (all === undefined) return each;
  return pending.length > UPDATE_ALL_FIRST_ABOVE ? [all, ...each] : [...each, all];
}

type ServerProcess = PiPackageUpdateFact["serverPluginProcesses"][number];

const PROCESS_WORDS: Readonly<Record<ServerProcess, string>> = { web: "the web server", sessiond: "the session daemon" };

const RELOAD_NOTE = "Running sessions keep the old version until you type /reload in them; new sessions use the new one.";
const PROVIDER_NOTE = "If an updated package adds a model provider, restart the session daemon.";
const USER_SCOPE_NOTE = "Packages a project declares in .pi/settings.json are not checked here.";

/** What an update leaves to do: always a /reload in running sessions; a restart of each process that loads a server plugin it brings; a provider cannot be detected, so it is said. */
export function packageRestartNotes(packages: readonly PiPackageUpdateFact[], updater: PiPackageUpdater | undefined): string[] {
  const updated = packages.filter((update) => updater?.outcome(update)?.kind === "updated");
  if (updated.length === 0) return [];
  const serverPlugins = updated
    .filter((update) => update.serverPluginProcesses.length > 0)
    .map((update) => `${packageNaming(update).name} brings a PI WEB server plugin: restart ${update.serverPluginProcesses.map((name) => PROCESS_WORDS[name]).join(" and ")}, then reload the tab.`);
  return [RELOAD_NOTE, ...serverPlugins, PROVIDER_NOTE];
}

const POPUP_TITLE = "Offer new versions in a pop-up";
const POPUP_DETAIL = "On this machine · each version once";

const POPUP_NOT_SAVED = "not saved";

/** The pop-up switch, the group's last row: a checkbox where the host draws one, else its state as a value. A refused change says so. */
function popupRow(actions: PiPackageGroupActions): PluginListRow {
  const enabled = actions.popupEnabled;
  const toggle = actions.togglePopup;
  const failed = actions.popupSave === "failed";
  const row: PluginListRow = { id: "popup", title: POPUP_TITLE, detail: POPUP_DETAIL };
  if (enabled === undefined) return { ...row, value: "unknown" };
  if (!actions.rowControls || toggle === undefined) return { ...row, value: joined(enabled ? "on" : "off", failed ? POPUP_NOT_SAVED : undefined) };
  return {
    ...row,
    ...(failed ? { status: { label: POPUP_NOT_SAVED, tone: "problem" } } : {}),
    toggle: { checked: enabled, busy: actions.popupSave === "saving", onChange: (checked) => { toggle(checked); } },
  };
}

/** An older host has no checkbox: the switch is the heading's button there. */
function fallbackPopupAction(actions: PiPackageGroupActions): PluginListAction | undefined {
  const toggle = actions.togglePopup;
  const enabled = actions.popupEnabled;
  if (actions.rowControls || toggle === undefined || enabled === undefined) return undefined;
  return { id: "popup-toggle", label: enabled ? "Turn pop-up off" : "Turn pop-up on", busy: actions.popupSave === "saving", run: () => { toggle(!enabled); } };
}

function groupHeading(piPackages: PiPackages, checked: string | undefined): string {
  if (piPackages?.checking === true) return "Pi packages · checking…";
  return checked === undefined ? "Pi packages" : `Pi packages · checked ${checked}`;
}

export function piPackagesGroup(piPackages: PiPackages, actions: PiPackageGroupActions, checked: string | undefined): { readonly group: PluginListGroup; readonly notes: readonly string[] } {
  const state = groupState(piPackages);
  if (state === "unreported") return { group: { id: "pi-packages", heading: "Pi packages", rows: [GROUP_ROW.unreported(piPackages)] }, notes: [] };
  const heading = groupHeading(piPackages, checked);
  const popupAction = fallbackPopupAction(actions);
  if (state !== "listed") {
    return {
      group: { id: "pi-packages", heading, rows: [GROUP_ROW[state](piPackages), popupRow(actions)], ...(popupAction === undefined ? {} : { headingAction: popupAction }) },
      notes: state === "none-installed" ? [USER_SCOPE_NOTE] : [],
    };
  }
  const packages = piPackages?.packages ?? [];
  const pending = pendingPackageUpdates(packages, actions.updater);
  const rows = [...packages.map((update) => piPackageRow(update, actions)), ...(piPackages?.unreadable ?? []).map(unreadableRow), popupRow(actions)];
  const notes = [...packageRestartNotes(packages, actions.updater), USER_SCOPE_NOTE];
  if (!actions.rowControls) {
    return { group: { id: "pi-packages", heading, rows, actions: fallbackUpdateActions(pending, actions.updater), ...(popupAction === undefined ? {} : { headingAction: popupAction }) }, notes };
  }
  const updateAll = updateAllAction(pending, actions.updater);
  return { group: { id: "pi-packages", heading, rows, ...(updateAll === undefined ? {} : { headingAction: updateAll }) }, notes };
}
