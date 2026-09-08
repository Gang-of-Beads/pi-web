import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type { PiWebServerPlugin, ServerPluginOperation } from "@gang-of-beads/pi-web/server-plugin-api";
import { GOALS_DIRECTORY, MAX_GOAL_FILES, parseGoalRecord, sortGoalRecords, type GoalDirectoryReading, type GoalRecordSummary } from "./goalRecords.js";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** A session cwd narrower than the workspace may carry its own goals; those
 *  overlay the workspace's by id, and both roots stay inside the workspace. */
export async function readGoalDirectory(workspacePath: string, sessionCwd: string | undefined): Promise<GoalDirectoryReading> {
  const roots = [workspacePath];
  const candidate = typeof sessionCwd === "string" && sessionCwd !== "" && isAbsolute(sessionCwd) ? resolve(sessionCwd) : undefined;
  if (candidate !== undefined && candidate !== workspacePath && candidate.startsWith(workspacePath)) roots.push(candidate);
  const byId = new Map<string, GoalRecordSummary>();
  let brokenFiles = 0;
  for (const root of roots) {
    let entries;
    try {
      entries = await readdir(join(root, GOALS_DIRECTORY), { withFileTypes: true });
    } catch {
      continue;
    }
    const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md")).slice(0, MAX_GOAL_FILES);
    for (const entry of files) {
      let text: string;
      try {
        text = await readFile(join(root, GOALS_DIRECTORY, entry.name), "utf8");
      } catch {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        brokenFiles += 1;
        continue;
      }
      const goal = parseGoalRecord(entry.name, parsed);
      if (goal === undefined) {
        brokenFiles += 1;
        continue;
      }
      byId.set(goal.id, goal);
    }
  }
  return { goals: sortGoalRecords([...byId.values()]), brokenFiles, roots };
}

export const listGoalsOperation: ServerPluginOperation = async (input) => {
  const request = isRecord(input) ? input : {};
  const workspacePath = typeof request["workspacePath"] === "string" && request["workspacePath"] !== "" ? request["workspacePath"] : undefined;
  if (workspacePath === undefined || !isAbsolute(workspacePath)) return { goals: [], brokenFiles: 0, roots: [] };
  const sessionCwd = typeof request["sessionCwd"] === "string" ? request["sessionCwd"] : undefined;
  const reading = await readGoalDirectory(workspacePath, sessionCwd);
  return {
    goals: reading.goals.map((goal) => ({ id: goal.id, objective: goal.objective, status: goal.status, tasksTotal: goal.tasksTotal, tasksDone: goal.tasksDone, updatedAt: goal.updatedAt })),
    brokenFiles: reading.brokenFiles,
    roots: reading.roots,
  };
};

const plugin: PiWebServerPlugin = {
  apiVersion: 1,
  name: "Goals",
  activate: () => ({
    operations: {
      "goals.list": listGoalsOperation,
    },
  }),
};

export default plugin;
