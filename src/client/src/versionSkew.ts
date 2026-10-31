/**
 * A browser tab keeps running the bundle it loaded, however many times the
 * server underneath it is upgraded. Every client-side fix shipped during that
 * time is invisible to the reader, who reports the same defect again - the
 * expensive way to learn the tab is stale. The server states its version; a
 * mismatch is an offer to reload, never an automatic one: reloading is the
 * reader's move, made when it will not lose them anything.
 */
/** The version a server or a page answers when it cannot read its own package version. */
const UNKNOWN_VERSION = "0.0.0-dev";

export function reloadOffer(clientVersion: string, serverVersion: string | undefined): string | undefined {
  if (clientVersion === "" || serverVersion === undefined || serverVersion === "") return undefined;
  // The server answers a placeholder when it cannot read its own package
  // version; offering a reload to "0.0.0-dev" would nag on every visibility
  // change and reloading would fix nothing. Unknown is not evidence.
  if (serverVersion === UNKNOWN_VERSION || clientVersion === UNKNOWN_VERSION) return undefined;
  return serverVersion === clientVersion ? undefined : serverVersion;
}

/** The server process that can run a build older than the one installed. */
export type StaleProcess = "web" | "sessiond";

/** A process running a build older than the one installed: which process, and both versions. */
export interface PendingRestart {
  readonly process: StaleProcess;
  readonly installedVersion: string;
  readonly runningVersion: string;
}

/**
 * What the server's version answer says (`api/pi-web/version`): the web process's running version,
 * and, when the web process or the session daemon runs a build older than the one installed, that
 * process and its installed and running versions.
 */
export interface ServerVersionFacts {
  readonly runtimeVersion: string | undefined;
  readonly pendingRestart?: PendingRestart;
}

/** The strip a page shows about its server's version, if any. */
export type VersionNotice =
  | { readonly kind: "none" }
  | { readonly kind: "reload"; readonly serverVersion: string }
  | ({ readonly kind: "restart" } & PendingRestart);

/**
 * Which strip the page shows. A server whose package was replaced on disk while its processes kept
 * running (an `npm install -g` with no restart) serves the new build's page from its old process:
 * the page then names a version newer than the server's, and reloading loads the same page again.
 * Offered only Reload, a phone stayed on "The server was updated to 2.202610.21; this page is
 * running 2.202610.24" through every reload (2026-10-31). The server knows when its installed build
 * is newer than a running one, so that state asks for a restart; a server that differs from the page
 * otherwise asks for a reload.
 */
export function versionNotice(clientVersion: string, facts: ServerVersionFacts | undefined): VersionNotice {
  if (facts === undefined) return { kind: "none" };
  const pending = facts.pendingRestart;
  if (pending !== undefined && pending.installedVersion !== UNKNOWN_VERSION && pending.runningVersion !== UNKNOWN_VERSION) return { kind: "restart", ...pending };
  const serverVersion = reloadOffer(clientVersion, facts.runtimeVersion);
  return serverVersion === undefined ? { kind: "none" } : { kind: "reload", serverVersion };
}

/** The notice a dismissal hides: the same strip for the same versions, so a later change shows again. */
export function versionNoticeKey(notice: VersionNotice): string | undefined {
  return notice.kind === "none" ? undefined : JSON.stringify(notice);
}
