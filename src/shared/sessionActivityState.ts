import type { SessionActivity, SessionStatus } from "./apiTypes.js";

/**
 * User-facing session state, one of five, in precedence order.
 *
 * The precedence matters: an ask is also "not working", an error is often the
 * end of a turn, and a queued prompt is still work. Classifying once here keeps
 * every surface (rows, dock, header) agreeing on what the session is doing.
 *
 * "background" sits between working and idle on purpose. The turn really has
 * ended — nothing will move without the user — so reporting it as working
 * would promise progress that is not coming; but children are still running,
 * so reporting it as idle hides work the user may be waiting on.
 */
export type SessionActivityCategory = "error" | "asking" | "working" | "background" | "idle";

/**
 * Whether the run ended owing the user a reply.
 *
 * A tool result is never the end of a turn: the model asked for the tool, so
 * it has to say something about what came back. A transcript whose last record
 * is a tool result therefore describes a turn that stopped early. The failure
 * that motivated this left nothing else to go on - no assistant message, no
 * error record, no failed request - so the shape of the transcript is the only
 * evidence there is.
 */
export function sessionActivityCategory(
  status: SessionStatus | undefined,
  activity: SessionActivity | undefined,
): SessionActivityCategory | undefined {
  if (activity?.phase === "error") return "error";
  if (status === undefined) return activity?.phase === "active" ? "working" : undefined;
  if (isWaitingForUser(status)) return "asking";
  const working = status.isStreaming || status.isBashRunning || status.isCompacting || status.pendingMessageCount > 0;
  if (working) return "working";
  if (activity?.phase === "active") return "working";
  if ((status.backgroundRunCount ?? 0) > 0) return "background";
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
