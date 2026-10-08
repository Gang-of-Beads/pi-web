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

/**
 * A goal file's record: the JSON object it starts with. pi-goal writes that object and then a
 * markdown copy of the prompt and progress for people (`# Goal Prompt`), and reads the file back
 * the same way (its `findJsonObjectEnd`). Parsing the whole file failed on every goal pi-goal
 * wrote, so the Goals page said "No goals in this workspace" beside a workspace full of them
 * (owner, 2026-10-08). undefined when the file does not start with a whole JSON object.
 */
export function leadingJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start === -1 || text.slice(0, start).trim() !== "") return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    if (depth === 0) return parsedOrUndefined(text.slice(start, index + 1));
  }
  return undefined;
}

function parsedOrUndefined(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

/** A goal record is the version-3 JSON object a goal file starts with (`leadingJsonObject`);
 *  the same files the goal runtime writes, read tolerantly (a broken file is counted,
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
