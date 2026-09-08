import { join } from "node:path";

export const GOALS_DIRECTORY = join(".pi", "goals");
export const MAX_GOAL_FILES = 50;

export type GoalStatus = "active" | "paused" | "blocked" | "budget_limited" | "complete";

export interface GoalRecordSummary {
  id: string;
  objective: string;
  status: GoalStatus;
  tasksTotal: number;
  tasksDone: number;
  updatedAt: string;
}

export interface GoalDirectoryReading {
  goals: GoalRecordSummary[];
  brokenFiles: number;
  roots: string[];
}

const KNOWN_STATUSES: readonly GoalStatus[] = ["active", "paused", "blocked", "budget_limited", "complete"];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const statusOf = (raw: Record<string, unknown>): GoalStatus => {
  for (const candidate of KNOWN_STATUSES) {
    if (raw["status"] === candidate || raw["currentStatus"] === candidate) return candidate;
  }
  return "active";
};

const taskListOf = (raw: Record<string, unknown>): { status?: unknown }[] => {
  const taskList = raw["taskList"];
  if (!isRecord(taskList)) return [];
  const tasks = taskList["tasks"];
  return Array.isArray(tasks) ? tasks.filter((task): task is { status?: unknown } => isRecord(task) || Array.isArray(task)) : [];
};

/** Goal records are version-3 JSON documents stored as `.md` files; the same
 *  files the goal runtime writes, read tolerantly (a broken file is counted,
 *  never fatal). */
export function parseGoalRecord(fileName: string, value: unknown): GoalRecordSummary | undefined {
  if (!isRecord(value)) return undefined;
  const objective = value["objective"];
  if (typeof objective !== "string" || objective.trim() === "") return undefined;
  const tasks = taskListOf(value);
  return {
    id: typeof value["id"] === "string" && value["id"] !== "" ? value["id"] : fileName.replace(/\.md$/, ""),
    objective,
    status: statusOf(value),
    tasksTotal: tasks.length,
    tasksDone: tasks.filter((task) => task.status === "complete").length,
    updatedAt: typeof value["updatedAt"] === "string" ? value["updatedAt"] : "",
  };
}

/** Active-shaped goals lead (newest first); finished ones trail. */
export function sortGoalRecords(goals: GoalRecordSummary[]): GoalRecordSummary[] {
  const settled = goals.filter((goal) => goal.status === "complete");
  const live = goals.filter((goal) => goal.status !== "complete");
  const byRecency = (left: GoalRecordSummary, right: GoalRecordSummary): number => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id);
  return [...live.sort(byRecency), ...settled.sort(byRecency)];
}
