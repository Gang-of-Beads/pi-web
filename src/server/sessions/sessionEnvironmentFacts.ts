/**
 * Session environment facts appended to every session's system prompt.
 *
 * Sessions run inside the session daemon, and everything an agent spawns —
 * the bash tool, terminals, subsessions — inherits the daemon's environment.
 * That inheritance is deliberate: `PI_WEB_SESSION=1` marks every spawned
 * process as nested inside this pi-web instance, the daemon's `PI_WEB_*`
 * wiring stays visible, and a second pi-web instance started with those
 * inherited values fails loudly at startup because the live instance owns the
 * state (see `sessiondStateOwnership`).
 *
 * The block tells the agent the nesting exists and which precautions follow,
 * so it learns the rules before discovering them by breaking its own session:
 * use a distinct data dir, socket, and ports for another instance, and restart
 * the web/API process before the session daemon when restarts are needed.
 * Restarts themselves are permitted (the owner's 2.2 ruling removed the old
 * "never restart" plea; the startup ownership claim enforces single-instance
 * state instead) — operator semantics are documented in `docs/install.html`
 * ("Session daemon ownership and restarts"), not duplicated into the prompt.
 */

import { piWebDataDir } from "../../config.js";
import { sessiondEndpointDescription } from "../../sessiond/config.js";

/** Agent-visible marker set by the session daemon: the process runs inside a pi-web session. */
export const PI_WEB_SESSION_ENV = "PI_WEB_SESSION";

export interface SessionEnvironmentFactsInput {
  readonly env: NodeJS.ProcessEnv;
}

/** Build the session environment facts block. */
export function sessionEnvironmentFacts({ env }: SessionEnvironmentFactsInput): string {
  const facts = [
    `This session runs inside a PI WEB session daemon. Every process spawned from it — the bash tool, terminals, subsessions — inherits \`${PI_WEB_SESSION_ENV}=1\`, marking it as nested inside this PI WEB instance.`,
    `The hosting instance owns the data directory \`${piWebDataDir(env)}\` and its session daemon listens on \`${sessiondEndpointDescription(env)}\`. Spawned processes inherit the daemon's \`PI_WEB_*\` environment, which points at that same live instance.`,
    "Starting another PI WEB instance with those inherited values fails loudly at startup because the live instance owns the state. To run a second instance, give it a distinct `PI_WEB_DATA_DIR`, `PI_WEB_SESSIOND_SOCKET` (or `PI_WEB_SESSIOND_PORT` / `PI_WEB_SESSIOND_HOST`), and `PI_WEB_PORT`.",
  ];
  return [
    "<pi_web_session_environment>",
    "Facts about the PI WEB session this agent runs in:",
    ...facts.map((fact) => `- ${fact}`),
    "</pi_web_session_environment>",
  ].join("\n");
}

export interface SessionEnvironmentPromptOptions {
  readonly env: NodeJS.ProcessEnv;
  /** Operator switch, resolved from `environmentFacts` config plus its env override. */
  readonly enabled: boolean;
}

/**
 * Resolve the system-prompt sections for session environment facts.
 *
 * Sessions are always nested in the daemon, so the facts apply to every
 * deployment; only the operator switch turns them off.
 */
export function sessionEnvironmentPromptSections({ env, enabled }: SessionEnvironmentPromptOptions): string[] {
  if (!enabled) return [];
  return [sessionEnvironmentFacts({ env })];
}
