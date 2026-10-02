import type { SessionActivityCategory } from "../../../shared/sessionActivityState";

/** The mark a session wears: its category from the one classifier (B14). */
export type SessionStateBadgeKind = SessionActivityCategory;

export const SESSION_STATE_LABELS: Record<SessionStateBadgeKind, string> = {
  working: "Session is working",
  background: "Turn ended; background work still running",
  idle: "Session is done",
  asking: "Waiting for your answer",
  error: "Session hit an error",
};
