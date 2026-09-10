import { CORE_STATUS_FLAGS, type StatusFlags } from "../../../shared/machineStatus";

/**
 * Work signals a row can show. At most one kind renders at a time; call sites
 * resolve precedence (sending > session > terminal) before rendering.
 */
export type ActivityIndicatorKind = "session" | "terminal" | "sending";

/**
 * Map a status node's flags onto the row's work mark.
 *
 * sessiond rolls the tree up, so a node can carry a flag id this build does
 * not know; such a flag must still light the row rather than blank it, hence
 * the generic session mark. Unread is an attention flag, not work, so it never
 * claims the mark here — call sites pass it to the renderers as a label.
 */
export function statusActivityKind(flags: StatusFlags | undefined): ActivityIndicatorKind | undefined {
  if (flags === undefined) return undefined;
  if (flags[CORE_STATUS_FLAGS.working] === true) return "session";
  if (flags[CORE_STATUS_FLAGS.terminal] === true) return "terminal";
  const hasOtherFlag = Object.entries(flags).some(([flagId, isSet]) => isSet && flagId !== CORE_STATUS_FLAGS.unread);
  return hasOtherFlag ? "session" : undefined;
}

/** Whether a status node carries unread work below it. */
export function hasStatusUnread(flags: StatusFlags | undefined): boolean {
  return flags?.[CORE_STATUS_FLAGS.unread] === true;
}

export type SessionStateBadgeKind = "working" | "background" | "idle" | "asking" | "error";

export const SESSION_STATE_LABELS: Record<SessionStateBadgeKind, string> = {
  working: "Session is working",
  background: "Turn ended; background work still running",
  idle: "Session is done",
  asking: "Waiting for your answer",
  error: "Session hit an error",
};
