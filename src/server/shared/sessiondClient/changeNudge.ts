import type { RealtimeEvent } from "../../../shared/apiTypes.js";
import type { SessionDaemonRequestClient } from "./sessionDaemonClient.js";

/**
 * A change a web-process writer tells its daemon about, so the daemon can announce it on every
 * browser's realtime socket (object model §1.14, state-diagram D5 "Every surface is live"). The
 * web process owns these stores but not the sockets: the daemon does. Each kind maps to the one
 * realtime event browsers act on.
 */
export type ChangeKind = "pins";

export const CHANGE_NUDGE_PATH = "/realtime/changed";

export const CHANGE_EVENTS = {
  pins: { type: "pins.changed" },
} as const satisfies Record<ChangeKind, RealtimeEvent>;

export function isChangeKind(value: unknown): value is ChangeKind {
  return typeof value === "string" && Object.hasOwn(CHANGE_EVENTS, value);
}

/** Tell the daemon a store changed. The write it follows already happened, so a failure here is the caller's to log, never to undo. */
export async function nudgeChange(daemon: SessionDaemonRequestClient, kind: ChangeKind): Promise<void> {
  const answer = await daemon.request("POST", CHANGE_NUDGE_PATH, { kind });
  if (answer.statusCode >= 300) throw new Error(`The session daemon refused the ${kind} change nudge (${String(answer.statusCode)})`);
}
