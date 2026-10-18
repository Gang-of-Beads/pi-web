import type { InlineExtension } from "@earendil-works/pi-coding-agent";

/**
 * The moment pi's `/new` is certain to switch, where PI WEB stops the session as Stop does (owner,
 * 2026-10-18: `/new` runs at once, as in pi's terminal).
 *
 * pi 1.3's `AgentSessionRuntime.newSession` emits `session_before_switch`, where an extension may
 * cancel, and then tears the session down, aborting the run first. pi offers no host hook between
 * the two, and PI WEB's Stop has to come before that abort: it settles run-scoped dialogs (the
 * abort waits for a parked `tool_call` dialog), marks the reply stopped by the reader before its
 * end is recorded, and takes the queued messages before the dying run can read them. pi's
 * extension runner calls the `session_before_switch` handlers in extension load order and returns
 * at the first cancel, and inline extensions load after every extension found on disk; so this
 * extension, given last, runs only when no other extension cancelled. The daemon checks that it
 * is last through the runner's public extension list before every `/new`
 * (`newSessionSeamRunsLast`), and refuses `/new` on a runtime where it is not. An SDK upgrade
 * re-checks this order (docs/releasing.md).
 */
export const NEW_SESSION_SEAM_EXTENSION = "pi-web-new-session";

/**
 * `switchCertain`: called with the session's id when its `/new` is certain to switch; it answers
 * a cancel only when stopping the session failed, so pi does not tear down a session PI WEB could
 * not stop.
 */
export function newSessionSeamExtension(switchCertain: (sessionId: string) => Promise<{ cancel: true } | undefined>): InlineExtension {
  return {
    name: NEW_SESSION_SEAM_EXTENSION,
    hidden: true,
    factory: (pi) => {
      pi.on("session_before_switch", (event, ctx) => (event.reason === "new" ? switchCertain(ctx.sessionManager.getSessionId()) : undefined));
    },
  };
}

/** Whether the seam is the last extension a session's runner calls; `undefined`: a runtime that does not say. */
export function newSessionSeamRunsLast(extensionPaths: readonly string[] | undefined): boolean {
  return extensionPaths?.at(-1) === `<inline:${NEW_SESSION_SEAM_EXTENSION}>`;
}
