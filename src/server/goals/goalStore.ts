import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { GoalRecordSummary, WorkspaceGoalsResponse } from "../../shared/apiTypes.js";
import { parseGoalFile, sortGoalSummaries } from "./goalFile.js";

/**
 * Directory, relative to a workspace, where `pi-goal-x` keeps its records.
 * Sessions of the same workspace share it, which is exactly why several goals
 * can be open at once.
 */
export const GOALS_DIRECTORY = join(".pi", "goals");

/**
 * Upper bound on files inspected per listing. A goal directory is small by
 * nature; the cap only stops a pathological directory from stalling a request.
 */
const MAX_GOAL_FILES = 200;

/**
 * List the goals recorded under a workspace.
 *
 * The directory is written concurrently by the extension (it keeps a `.locks/`
 * subdirectory for exactly that reason), so this reader treats an unreadable
 * or half-written file as absent rather than as an error: a transient parse
 * failure must not blank the panel for every other goal. A missing directory
 * is simply "no goals", which is the common case.
 */
export async function readWorkspaceGoals(workspacePath: string, now = () => new Date()): Promise<WorkspaceGoalsResponse> {
  const directory = join(workspacePath, GOALS_DIRECTORY);
  const response = (goals: GoalRecordSummary[]): WorkspaceGoalsResponse => ({
    goals,
    directory,
    generatedAt: now().toISOString(),
  });

  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return response([]);
  }

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .slice(0, MAX_GOAL_FILES);

  const goals: GoalRecordSummary[] = [];
  await Promise.all(files.map(async (entry) => {
    const path = join(directory, entry.name);
    let content: string;
    try {
      content = await readFile(path, "utf8");
    } catch {
      return;
    }
    const goal = parseGoalFile(content, path);
    if (goal !== undefined) goals.push(goal);
  }));

  // Records are keyed by id, but a goal that was archived to a second file
  // would otherwise appear twice; the most recently updated copy wins.
  const byId = new Map<string, GoalRecordSummary>();
  for (const goal of goals) {
    const existing = byId.get(goal.id);
    if (existing === undefined || (goal.updatedAt ?? "") > (existing.updatedAt ?? "")) byId.set(goal.id, goal);
  }

  return response(sortGoalSummaries([...byId.values()]));
}
