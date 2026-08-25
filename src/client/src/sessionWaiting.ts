import type { SessionStatus } from "../../shared/apiTypes";

/**
 * Whether a session is holding still for the user rather than for itself.
 *
 * Two things park a run on an answer: an `ask_user` question set and an
 * extension dialog (`ctx.ui.confirm` / `select` / `input`). They arrive on the
 * status through different fields, and every surface that reported "waiting"
 * used to consult only the first — so a blocking dialog, often with a
 * countdown that cancels it, was shown as an idle session in the status dock,
 * in the session list and in the quick switcher at the same time.
 */
export function isWaitingForUser(status: Pick<SessionStatus, "pendingAsk" | "pendingDialogs"> | undefined): boolean {
  if (status === undefined) return false;
  return status.pendingAsk !== undefined || (status.pendingDialogs?.length ?? 0) > 0;
}
