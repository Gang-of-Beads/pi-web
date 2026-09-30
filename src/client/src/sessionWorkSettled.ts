import { isSessionActive } from "../../shared/activity";
import type { SessionActivity, SessionStatus } from "./api";

export interface SessionWorkState {
  readonly selectedSession?: { readonly id: string } | undefined;
  readonly status?: SessionStatus | undefined;
  readonly activity?: SessionActivity | undefined;
}

/**
 * Whether the selected session's work settled between two app states, which
 * the host announces to plugins as `session-activity-settled` and answers by
 * refreshing the open workspace tool.
 *
 * Its turn ending is one such edge. The last of its background runs ending is
 * the other: a subagent or background task can outlive the turn that started
 * it, and a panel that stopped reading when the turn ended (the subagents run
 * list, the files tree) would otherwise keep what it read while the run was
 * still going. Only the same session's runs count: a selection that leaves a
 * session with runs going has settled nothing.
 */
export function sessionWorkSettled(previous: SessionWorkState, next: SessionWorkState): boolean {
  const turnEnded = isSessionActive(previous.status, previous.activity) && !isSessionActive(next.status, next.activity);
  return turnEnded || lastRunEnded(previous, next);
}

function lastRunEnded(previous: SessionWorkState, next: SessionWorkState): boolean {
  const sameSession = previous.selectedSession?.id !== undefined && previous.selectedSession.id === next.selectedSession?.id;
  return sameSession
    && (previous.status?.backgroundRunCount ?? 0) > 0
    && (next.status?.backgroundRunCount ?? 0) === 0
    && !isSessionActive(next.status, next.activity);
}
