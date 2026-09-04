import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import type { GoalRecordSummary, WorkspaceGoalsResponse } from "./goalTypes.js";
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
 *
 * The extension records under the focused session's cwd, which can differ from
 * the workspace root - a session started in a sibling checkout writes beside
 * itself, and a read of the workspace alone reports no goals while one sits on
 * disk. When the caller supplies a divergent session cwd, both roots are read
 * and unioned: every record then carries its `sourceRoot`, and a goal present
 * in both is listed once with the workspace copy, which is the root this
 * response primarily answers for.
 */
export async function readWorkspaceGoals(workspacePath: string, options: { sessionCwd?: string } = {}, now = () => new Date()): Promise<WorkspaceGoalsResponse> {
  const directory = join(workspacePath, GOALS_DIRECTORY);
  const response = (goals: GoalRecordSummary[]): WorkspaceGoalsResponse => ({
    goals,
    directory,
    generatedAt: now().toISOString(),
  });

  const sessionCwd = options.sessionCwd;
  const candidate = sessionCwd !== undefined && sessionCwd !== "" && sessionCwd !== workspacePath ? sessionCwd : undefined;
  // A session cwd contributes goals only when it answers for this workspace:
  // a cwd inside the root (a session working in a subdirectory). The selected
  // session is global state that can lag the workspace selection, so an
  // outside cwd here means another project's session — unioning its goal
  // directory presented another project's goal on this panel with live
  // controls.
  const contained = candidate !== undefined && isInsideRoot(workspacePath, candidate);
  const sessionRoot = contained ? candidate : undefined;
  const workspaceGoals = await readGoalsFromRoot(workspacePath);
  if (sessionRoot === undefined) return response(workspaceGoals);

  const sessionGoals = await readGoalsFromRoot(sessionRoot);
  const byId = new Map<string, GoalRecordSummary>();
  // The workspace copy wins an overlap: this response answers for the workspace
  // first, and the session root is the guest here.
  for (const goal of sessionGoals) byId.set(goal.id, { ...goal, sourceRoot: sessionRoot });
  for (const goal of workspaceGoals) byId.set(goal.id, { ...goal, sourceRoot: workspacePath });
  return response(sortGoalSummaries([...byId.values()]));
}

async function readGoalsFromRoot(root: string): Promise<GoalRecordSummary[]> {
  const directory = join(root, GOALS_DIRECTORY);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    // A missing directory is legitimately empty (no goals recorded yet). Any
    // other failure - unreadable permissions, an I/O error - is a FAILED read:
    // swallowing it here would surface a successful empty list, and the
    // browser would claim "No goals recorded" over goals it cannot see.
    const code: unknown = typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
    if (code === "ENOENT") return [];
    throw error;
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
  return [...byId.values()];
}

/** True when candidate is workspacePath itself or a path beneath it. */
function isInsideRoot(workspacePath: string, candidate: string): boolean {
  const rel = relative(workspacePath, candidate);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}
