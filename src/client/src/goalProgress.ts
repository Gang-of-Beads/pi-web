import type { GoalRecordSummary, GoalTaskSummary } from "./api";

/**
 * Presentation helpers for goal records.
 *
 * Kept apart from the component so the arithmetic and wording are unit-tested
 * without rendering, and so the same vocabulary is available to any other
 * surface that wants to show goal progress.
 */

/** A goal whose work is over: listed for the record, never as pending work. */
export function isGoalFinished(goal: Pick<GoalRecordSummary, "status">): boolean {
  return goal.status === "complete" || goal.status === "completed" || goal.status === "abandoned";
}

/** A goal that needs the user rather than the agent to move. */
export function isGoalBlocked(goal: Pick<GoalRecordSummary, "status">): boolean {
  return goal.status === "paused" || goal.status === "blocked" || goal.status === "budget_limited";
}

/**
 * Completion as a 0–1 fraction. A goal with no tasks reports 0 rather than 1:
 * "nothing to do" is not "everything done", and showing a full bar for an
 * untasked goal would misreport an active objective as finished.
 */
export function goalProgressFraction(goal: Pick<GoalRecordSummary, "completedTaskCount" | "totalTaskCount">): number {
  if (goal.totalTaskCount <= 0) return 0;
  return Math.min(1, Math.max(0, goal.completedTaskCount / goal.totalTaskCount));
}

/** Short ratio for the row header, or a status word when there are no tasks. */
export function goalProgressLabel(goal: Pick<GoalRecordSummary, "completedTaskCount" | "totalTaskCount">): string {
  if (goal.totalTaskCount <= 0) return "No tasks";
  return `${String(goal.completedTaskCount)}/${String(goal.totalTaskCount)}`;
}

/**
 * Human wording for an extension-owned status. Unknown values are passed
 * through with underscores relaxed, so a status this build has never heard of
 * still reads as itself instead of as "unknown".
 */
export function goalStatusLabel(status: string): string {
  switch (status) {
    case "active": return "Active";
    case "paused": return "Paused";
    case "blocked": return "Blocked";
    case "complete":
    case "completed": return "Complete";
    case "abandoned": return "Abandoned";
    case "budget_limited": return "Budget reached";
    default: return status.replace(/_/gu, " ");
  }
}

/** The task the agent reported working on, including nested subtasks. */
export function findCurrentTask(goal: Pick<GoalRecordSummary, "tasks" | "currentTaskId">): GoalTaskSummary | undefined {
  if (goal.currentTaskId === undefined) return undefined;
  return findTaskById(goal.tasks, goal.currentTaskId);
}

function findTaskById(tasks: readonly GoalTaskSummary[], id: string): GoalTaskSummary | undefined {
  for (const task of tasks) {
    if (task.id === id) return task;
    const nested = task.subtasks === undefined ? undefined : findTaskById(task.subtasks, id);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

/** Flatten a task tree into rows carrying their depth, for indented rendering. */
export function flattenGoalTasks(tasks: readonly GoalTaskSummary[], depth = 0): { task: GoalTaskSummary; depth: number }[] {
  const rows: { task: GoalTaskSummary; depth: number }[] = [];
  for (const task of tasks) {
    rows.push({ task, depth });
    if (task.subtasks !== undefined) rows.push(...flattenGoalTasks(task.subtasks, depth + 1));
  }
  return rows;
}

/** Compact token count for the goal row (1.1M, 24k, 900). */
export function formatGoalTokens(tokens: number | undefined): string | undefined {
  if (tokens === undefined || tokens <= 0) return undefined;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M tokens`;
  if (tokens >= 1_000) return `${String(Math.round(tokens / 1_000))}k tokens`;
  return `${String(tokens)} tokens`;
}
