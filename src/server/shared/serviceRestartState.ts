import type { PiWebOwnService, PiWebServiceRestartState } from "../../shared/apiTypes.js";
import type { DeclaredUpdateCommand } from "./deploymentUpdateCommand.js";

/**
 * Whether a component's restart through this user's installed services would restart the
 * component itself. The services are found by their files, which say nothing about which PI WEB
 * runs under them: a second PI WEB on the same account was offered the first one's restart, and
 * pressing it stopped every session of the first. So the restart follows the service the
 * component's own process reports. A component that reports none (`ownService` undefined: a
 * session daemon that is down, did not answer, or predates the report) is matched only through
 * `installationConfirmed`: the web process runs under a service of the same installed set, which
 * installs the daemon's service with it. A component that answers unknown is not a match.
 */
export function serviceRestartState(installedServices: ReadonlySet<string>, ownService: PiWebOwnService | undefined, installationConfirmed: boolean): PiWebServiceRestartState {
  if (installedServices.size === 0) return "no-service-installed";
  if (ownService === undefined) return installationConfirmed ? "installation-runs-under-service" : "unknown";
  if (ownService.kind === "unknown") return "unknown";
  if (ownService.kind === "none") return "not-under-service-manager";
  return installedServices.has(ownService.name) ? "runs-under-service" : "other-service";
}

/** Whether each state offers the component's restart. */
export const serviceRestartOffered: Readonly<Record<PiWebServiceRestartState, boolean>> = {
  "runs-under-service": true,
  "installation-runs-under-service": true,
  "other-service": false,
  "not-under-service-manager": false,
  unknown: false,
  "no-service-installed": false,
};

/**
 * Whether restarting every installed service restarts this PI WEB and nothing else, the question
 * behind every restart that is not one component's (Settings → Machines, `POST /api/pi-web/restart`,
 * `pi-web restart`) and behind an update command inherited from the services' environment.
 * `unchecked`: Windows, or a host without a service manager this check reads, where callers keep
 * their behaviour; `not-installed`: no PI WEB service is installed for this user.
 */
export type InstallationRestartState = "unchecked" | "not-installed" | "confirmed" | "other-installation" | "unconfirmed";

export function installationRestartState(scope: { installedCount: number; whole: boolean; states: readonly PiWebServiceRestartState[] } | undefined): InstallationRestartState {
  if (scope === undefined) return "unchecked";
  if (scope.installedCount === 0) return "not-installed";
  if (scope.whole) return "confirmed";
  return scope.states.includes("unknown") ? "unconfirmed" : "other-installation";
}

/** Why a restart of every installed service is refused, in the words the refusing row shows; undefined starts it. */
export const installationRestartRefusal: Readonly<Record<InstallationRestartState, string | undefined>> = {
  unchecked: undefined,
  confirmed: undefined,
  "not-installed": "No PI WEB services are installed for this user, so restart it the way it was started",
  "other-installation": "This PI WEB does not run under the services installed for this user, so restart it the way it was started",
  unconfirmed: "This PI WEB could not confirm it runs under the services installed for this user, so restart it the way it was started",
};

/**
 * Whether an update command taken from the process environment (`PI_WEB_UPDATE_COMMAND`) is
 * offered. The services declare it for themselves, and every process started from one of their
 * terminals inherits it: a second PI WEB started there would update and restart the first. A
 * command saved in this PI WEB's own config is its own and is not gated.
 */
const environmentUpdateOffered: Readonly<Record<InstallationRestartState, boolean>> = {
  unchecked: true,
  "not-installed": true,
  confirmed: true,
  "other-installation": false,
  unconfirmed: false,
};

/** Whether a declared update command is this PI WEB's to offer and run, for the Updates page and the self-update route alike. */
export function declaredUpdateOffered(declared: DeclaredUpdateCommand, installation: InstallationRestartState): boolean {
  return declared.source === "config" || environmentUpdateOffered[installation];
}
