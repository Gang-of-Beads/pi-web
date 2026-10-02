import type { SessionStep } from "../../shared/apiTypes";
import { runningToolLine } from "../../shared/runningToolLine";

/**
 * What the status line says for the agent's step (B25, state-diagram D3 "The
 * status line narrates"): the step with its object, how long it has run, and
 * when what waits for the agent is read.
 *
 * The line used to show the daemon's last event word, so "message queued"
 * stood for a whole turn while the agent worked and two queued messages
 * waited with no reason given (owner, 2026-09-30). Every word here belongs to
 * a step kind in one table; nothing is decided from words.
 */
const STEP_TEXT: Readonly<Record<SessionStep["kind"], (step: SessionStep) => string>> = {
  idle: () => "Idle",
  waiting: () => "Waiting for the model",
  thinking: () => "Thinking",
  writing: () => "Writing the reply",
  preparing: (step) => (step.kind === "preparing" && step.tool !== undefined ? `Preparing ${step.tool}` : "Preparing a tool call"),
  running: (step) => (step.kind === "running" ? `Running ${step.tools.map(runningToolLine).join(" · ")}` : "Running a tool"),
  retrying: (step) => (step.kind === "retrying" ? `Retrying, attempt ${String(step.attempt)} of ${String(step.maxAttempts)}${step.reason === "" ? "" : `: ${step.reason}`}` : "Retrying"),
  compacting: () => "Compacting the history",
  bash: (step) => (step.kind === "bash" ? `Running ${step.command}` : "Running a command"),
};

/** When something waiting for the agent is read, from the step it waits behind. */
const READ_WHEN: Readonly<Record<SessionStep["kind"], string>> = {
  idle: "next",
  waiting: "next",
  thinking: "when this reply ends",
  writing: "when this reply ends",
  preparing: "when this reply ends",
  running: "when these tools finish",
  retrying: "next",
  compacting: "next",
  bash: "next",
};

/** The step and how long it has run: "Running bash: sleep 25 · 12 s". */
export function stepStatusText(step: SessionStep, sinceMs: number | undefined, nowMs: number): string {
  const text = STEP_TEXT[step.kind](step);
  if (step.kind === "idle" || sinceMs === undefined) return text;
  return `${text} · ${elapsed(nowMs - sinceMs)}`;
}

/**
 * What waits for the agent and when it is read: "2 messages are read when
 * these tools finish". Steered messages and answers are read at the step's
 * injection point; a follow-up (sent through the API or an extension, never
 * the composer while a reply runs) only once the agent has nothing left to do.
 */
export function stepWaitingText(step: SessionStep, waiting: { messages: number; followUps: number; answers: number }): string | undefined {
  const steered = [
    waiting.answers === 0 ? undefined : waiting.answers === 1 ? "your answer" : `${String(waiting.answers)} answers`,
    waiting.messages === 0 ? undefined : waiting.messages === 1 ? "1 message" : `${String(waiting.messages)} messages`,
  ].filter((part): part is string => part !== undefined);
  const clauses = [
    steered.length === 0 ? undefined : `${steered.join(" and ")} ${waiting.messages + waiting.answers === 1 ? "is" : "are"} read ${READ_WHEN[step.kind]}`,
    waiting.followUps === 0 ? undefined : `${waiting.followUps === 1 ? "1 follow-up is" : `${String(waiting.followUps)} follow-ups are`} read when the agent is done`,
  ].filter((clause): clause is string => clause !== undefined);
  return clauses.length === 0 ? undefined : clauses.join(" · ");
}

function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${String(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)} min ${String(seconds % 60)} s`;
}
