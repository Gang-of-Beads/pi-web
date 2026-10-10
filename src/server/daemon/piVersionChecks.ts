/**
 * Pi's own update checks stay quiet inside the session daemon (owner, 2026-10-04).
 *
 * Extensions that offer pi updates honour `PI_SKIP_VERSION_CHECK`. Inside PI WEB
 * their offer cannot work: "Update now" re-executes `process.argv[1]`, which is the daemon's own
 * entry, and that second daemon fails the ownership claim. It also compares against the pi bundled
 * with PI WEB, not the pi the user runs. PI WEB's own update flow replaces it. The variable is set
 * for the daemon process only: terminals spawned by the daemon get it back out of their
 * environment, so a pi started there checks for updates as it would anywhere else. A value the
 * user set themselves is left alone, in the daemon and in terminals.
 */
const SKIP_VERSION_CHECK = "PI_SKIP_VERSION_CHECK";

let setByDaemon = false;

export function quietPiVersionChecks(env: NodeJS.ProcessEnv = process.env): void {
  const current = env[SKIP_VERSION_CHECK];
  if (current !== undefined && current !== "") return;
  env[SKIP_VERSION_CHECK] = "1";
  setByDaemon = true;
}

/** The daemon's environment as a terminal should inherit it: without the quiet the daemon added for itself. */
export function terminalEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (!setByDaemon) return { ...env };
  return Object.fromEntries(Object.entries(env).filter(([key]) => key !== SKIP_VERSION_CHECK));
}
