import type { SessionActivity, SessionStatus } from "./apiTypes.js";
import { busyStates, type DeclaredSessionState } from "./declaredSessionStates.js";

/**
 * User-facing session state, one of six, in precedence order.
 *
 * The precedence matters: an open dialog is also "not working", an error is
 * often the end of a turn, and a queued prompt is still work. Classifying once
 * here keeps every surface (rows, dock, header) agreeing on what the session is
 * doing.
 *
 * "busy" sits between working and idle on purpose. The turn really has ended - nothing will move
 * without the user - so reporting it as working would promise progress that is not coming; but
 * something an extension declared is still going on (`declaredBusyStates`), so reporting it as idle
 * hides work the user may be waiting on. Core does not know what that work is: the declaring
 * extension names it, and the surfaces show its words.
 *
 * "opening" is a runtime being started for the session (its extensions loading), reported by the
 * daemon's startup frames. It is not the agent working (owner, 2026-10-12: a tapped session read as
 * running while it was only being opened), so it sits below real work and the row wears the tap's
 * own opening spinner until the startup ends.
 */
export type SessionActivityCategory = "asking" | "error" | "working" | "opening" | "busy" | "idle";

/**
 * The one category a session shows, first match wins: an open dialog, then a failed run, then
 * work in flight (streaming, a shell command, compaction, a queued message or an active run),
 * then a runtime being opened, then work an extension declared, else idle. Without a status only
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
  if (declaredBusyStates(status).length > 0) return "busy";
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

/** The owner the counted runs of `backgroundWork` are declared under: a count with no words of its own. */
const COUNTED_RUNS_OWNER = "plugins";

/**
 * The declared states of a session that mean work is going on. A daemon older than declared states
 * sends only a count of background runs; that count is read as the one state it was.
 */
export function declaredBusyStates(status: Pick<SessionStatus, "declaredStates" | "backgroundRunCount"> | undefined): readonly DeclaredSessionState[] {
  if (status === undefined) return [];
  if (status.declaredStates !== undefined) return busyStates(status.declaredStates);
  const runs = status.backgroundRunCount ?? 0;
  return runs === 0 ? [] : [{ owner: COUNTED_RUNS_OWNER, id: "background", label: `${String(runs)} background ${runs === 1 ? "run" : "runs"}`, tone: "accent", busy: true, count: runs }];
}

/**
 * The words of the declared work, each owner's own, joined as one line. The runs plugins count
 * through `backgroundWork` are left out: the plugin that counts them says so in its activity note,
 * and saying it here as well would say it twice.
 */
export function declaredBusyWords(status: Pick<SessionStatus, "declaredStates" | "backgroundRunCount"> | undefined): string | undefined {
  const states = declaredBusyStates(status).filter((state) => state.owner !== COUNTED_RUNS_OWNER);
  return states.length === 0 ? undefined : states.map((state) => state.label).join(" · ");
}
