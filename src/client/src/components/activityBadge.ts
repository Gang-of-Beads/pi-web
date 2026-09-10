export type SessionStateBadgeKind = "working" | "background" | "idle" | "asking" | "error";

export const SESSION_STATE_LABELS: Record<SessionStateBadgeKind, string> = {
  working: "Session is working",
  background: "Turn ended; background work still running",
  idle: "Session is done",
  asking: "Waiting for your answer",
  error: "Session hit an error",
};
