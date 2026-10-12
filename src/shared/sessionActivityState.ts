import type { SessionActivity, SessionStatus } from "./apiTypes.js";

/**
 * User-facing session state, one of five, in precedence order.
 *
 * The precedence matters: an open dialog is also "not working", an error is
 * often the end of a turn, and a queued prompt is still work. Classifying once
 * here keeps every surface (rows, dock, header) agreeing on what the session is
 * doing.
 *
 * "background" sits between working and idle on purpose. The turn really has
 * ended — nothing will move without the user — so reporting it as working
 * would promise progress that is not coming; but children are still running,
 * so reporting it as idle hides work the user may be waiting on.
 *
 * "opening" is a runtime being started for the session (its extensions loading), reported by the
 * daemon's startup frames. It is not the agent working (owner, 2026-10-12: a tapped session read as
 * running while it was only being opened), so it sits below real work and the row wears the tap's
 * own opening spinner until the startup ends.
 */
export type SessionActivityCategory = "asking" | "error" | "working" | "opening" | "background" | "idle";

/**
 * The one category a session shows, first match wins: an open dialog, then a failed run, then
 * work in flight (streaming, a shell command, compaction, a queued message or an active run),
 * then a runtime being opened, then runs left in the background, else idle. Without a status only
 * the activity speaks: a failed run, an opening or an active one, or nothing (undefined).
 */
export function sessionActivityCategory(
  status: SessionStatus | undefined,
  activity: SessionActivity | undefined,
): SessionActivityCategory | undefined {
  if (isWaitingForUser(status)) return "asking";
  if (activity?.phase === "error") return "error";
  const activeKind = activity?.phase !== "active" ? undefined : activity.startup === true ? "opening" : "working";
  if (status === undefined) return activeKind;
  const working = status.isStreaming || status.isBashRunning || status.isCompacting || status.pendingMessageCount > 0;
  if (working) return "working";
  if (activeKind !== undefined) return activeKind;
  if ((status.backgroundRunCount ?? 0) > 0) return "background";
  return "idle";
}

/**
 * Whether a session is holding still for the user rather than for itself.
 *
 * What parks a run on an answer is an open extension dialog
 * (`ctx.ui.confirm`/`select`/`input`/`editor`/`custom`): a session blocked on one
 * is waiting for the reader, not working and not idle.
 */
export function isWaitingForUser(status: Pick<SessionStatus, "pendingDialogs"> | undefined): boolean {
  if (status === undefined) return false;
  return (status.pendingDialogs?.length ?? 0) > 0;
}
