import type { SessionActivity, SessionStatus } from "./apiTypes.js";

/**
 * User-facing session state, one of four, in precedence order.
 *
 * The precedence matters: an ask is also "not working", an error is often the
 * end of a turn, and a queued prompt is still work. Classifying once here keeps
 * every surface (rows, dock, header) agreeing on what the session is doing.
 */
export type SessionActivityCategory = "error" | "asking" | "working" | "idle";

export function sessionActivityCategory(status: SessionStatus | undefined, activity: SessionActivity | undefined): SessionActivityCategory | undefined {
  if (activity?.phase === "error") return "error";
  if (status === undefined) return activity?.phase === "active" ? "working" : undefined;
  if (isWaitingForUser(status)) return "asking";
  const working = status.isStreaming || status.isBashRunning || status.isCompacting || status.pendingMessageCount > 0;
  if (working) return "working";
  if (activity?.phase === "active") return "working";
  return "idle";
}

/**
 * Whether a session is holding still for the user rather than for itself.
 *
 * Two things park a run on an answer: an `ask_user` question set and an
 * extension dialog (`ctx.ui.confirm`/`select`/`input`). They arrive on the
 * status through different fields, and a surface that consults only the first
 * reports a session blocked on a countdown dialog as idle.
 */
export function isWaitingForUser(status: Pick<SessionStatus, "pendingAsk" | "pendingDialogs"> | undefined): boolean {
  if (status === undefined) return false;
  return status.pendingAsk !== undefined || (status.pendingDialogs?.length ?? 0) > 0;
}
