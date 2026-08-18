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
  if (status.pendingAsk !== undefined) return "asking";
  const working = status.isStreaming || status.isBashRunning || status.isCompacting || status.pendingMessageCount > 0;
  if (working) return "working";
  if (activity?.phase === "active") return "working";
  return "idle";
}
