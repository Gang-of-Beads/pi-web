import type { PiWebServiceRestartState } from "./pluginApiTypes.js";
/**
 * The one rule, and the one set of words, for restarting PI WEB through the services installed for
 * this user. The server refuses by it (`POST /api/pi-web/restart`, the fleet run, the self-update
 * route), and the browser draws by it (Settings → Machines, the Updates page, the update pop-up),
 * so a key is drawn exactly where the server would act and says the server's own reason where it
 * would not. Pure: no process, file or service-manager access, so both sides can load it.
 */
/** Whether each component state offers that component's restart through the installed services. */
export declare const serviceRestartOffered: Readonly<Record<PiWebServiceRestartState, boolean>>;
/**
 * Whether restarting every installed service restarts this PI WEB and nothing else, the question
 * behind every restart that is not one component's (Settings → Machines, `POST /api/pi-web/restart`,
 * `pi-web restart`) and behind an update command inherited from the services' environment.
 * `unchecked`: Windows, or a host without a service manager the check reads, where callers keep
 * their behaviour; `not-installed`: no PI WEB service is installed for this user.
 */
export type InstallationRestartState = "unchecked" | "not-installed" | "confirmed" | "other-installation" | "unconfirmed";
/**
 * The installation's state from its components' states (`undefined`: no states were read, the
 * `unchecked` host). A component with no service installed takes no part; the restart is confirmed
 * when every component that has one runs under it.
 */
export declare function installationRestartState(componentStates: readonly PiWebServiceRestartState[] | undefined): InstallationRestartState;
/** Why a restart of every installed service is refused: the server's refusal and the words every withheld restart key shows. Undefined where it starts. */
export declare const installationRestartRefusal: Readonly<Record<InstallationRestartState, string | undefined>>;
/**
 * The sentence the Updates page shows beside one service, for its component's state: the
 * installation's refusal for a component that does not run under its service, and none where its
 * restart is offered or it has no service of its own. These are words, not the answer to "is a
 * restart offered": that is `serviceRestartOffered`, and for the whole installation
 * `installationRestartState`.
 */
export declare const SERVICE_RESTART_NOTES: Readonly<Record<PiWebServiceRestartState, string | undefined>>;
