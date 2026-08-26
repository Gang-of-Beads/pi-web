import type { SessionActivity, SessionStatus } from "./apiTypes.js";

/**
 * User-facing session state, one of four, in precedence order.
 *
 * The precedence matters: an ask is also "not working", an error is often the
 * end of a turn, and a queued prompt is still work. Classifying once here keeps
 * every surface (rows, dock, header) agreeing on what the session is doing.
 */
export type SessionActivityCategory = "error" | "asking" | "working" | "stalled" | "idle";

/** The part of a recorded message this rule needs: who produced it. */
export interface RecordedRole {
  readonly role: string;
}

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
/**
 * Roles that carry tool output, in both vocabularies this rule sees: the raw
 * session records write `toolResult`, while the client's messages arrive split
 * by the kind of tool that produced them.
 */
const TOOL_OUTPUT_ROLES = new Set(["toolResult", "tool", "bash", "skill"]);

export function turnEndedUnanswered(recent: readonly RecordedRole[] | undefined): boolean {
  const last = recent === undefined || recent.length === 0 ? undefined : recent[recent.length - 1];
  return last !== undefined && TOOL_OUTPUT_ROLES.has(last.role);
}

export function sessionActivityCategory(
  status: SessionStatus | undefined,
  activity: SessionActivity | undefined,
  recent?: readonly RecordedRole[],
): SessionActivityCategory | undefined {
  if (activity?.phase === "error") return "error";
  if (status === undefined) return activity?.phase === "active" ? "working" : undefined;
  if (isWaitingForUser(status)) return "asking";
  const working = status.isStreaming || status.isBashRunning || status.isCompacting || status.pendingMessageCount > 0;
  if (working) return "working";
  if (activity?.phase === "active") return "working";
  // Only once nothing is running: a tool result is the newest record during
  // normal work too, and that is not a stall.
  if (turnEndedUnanswered(recent)) return "stalled";
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
