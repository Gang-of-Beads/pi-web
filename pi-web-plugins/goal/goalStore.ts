import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseGoalRecord, type AllGoalsRead, type GoalRecord, type WorkspaceGoals, type WorkspaceGoalsRead } from "./goalRecords.js";

/**
 * Reads pi-goal's goal files, never writes them.
 *
 * pi-goal keeps each goal in `<agent dir>/pi-goal/goals/<sha256 of the workspace path>/<uuid>.json`,
 * with a `workspace.json` naming the workspace in each directory (pi-goal's docs/storage.md). The
 * agent directory follows pi's own rule: `PI_CODING_AGENT_DIR` (a leading `~` expanded), else
 * `~/.pi/agent`. Every change goes through pi-goal's `/goal` command, so a read here can never race
 * pi-goal's guard against overwriting another session's edits.
 */
export interface GoalFiles {
  readonly readdir: (path: string) => Promise<string[]>;
  readonly readFile: (path: string) => Promise<string>;
}

export const nodeGoalFiles: GoalFiles = {
  readdir: (path) => readdir(path),
  readFile: (path) => readFile(path, "utf8"),
};

const WORKSPACE_FILE = "workspace.json";
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const WORKSPACE_KEY = /^[0-9a-f]{64}$/u;

export function agentDirectory(env: Readonly<Record<string, string | undefined>>, home: string = homedir()): string {
  const configured = env["PI_CODING_AGENT_DIR"];
  if (configured === undefined || configured === "") return join(home, ".pi", "agent");
  if (configured === "~") return home;
  return configured.startsWith("~/") ? join(home, configured.slice(2)) : configured;
}

export function goalsRoot(agentDir: string): string {
  return join(agentDir, "pi-goal", "goals");
}

export function workspaceKey(workspace: string): string {
  return createHash("sha256").update(resolve(workspace)).digest("hex");
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function listOrMissing(files: GoalFiles, path: string): Promise<string[] | undefined> {
  try {
    return await files.readdir(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

async function readGoal(files: GoalFiles, directory: string, name: string, workspace: string): Promise<GoalRecord | undefined> {
  const uuid = name.slice(0, -".json".length);
  if (!UUID_V7.test(uuid)) return undefined;
  try {
    const parsed: unknown = JSON.parse(await files.readFile(join(directory, name)));
    return parseGoalRecord(parsed, uuid, workspace);
  } catch {
    return undefined;
  }
}

async function readGoalsIn(files: GoalFiles, directory: string, names: readonly string[], workspace: string): Promise<WorkspaceGoals> {
  const goalNames = names.filter((name) => name.endsWith(".json") && name !== WORKSPACE_FILE).sort();
  const goals = await Promise.all(goalNames.map((name) => readGoal(files, directory, name, workspace)));
  const valid = goals.filter((goal): goal is GoalRecord => goal !== undefined);
  return { directory: workspace, goals: valid, skipped: goals.length - valid.length };
}

/** The goals pi-goal stored for one workspace path. A directory that does not exist is `ready` with none. */
export async function readWorkspaceGoals(files: GoalFiles, agentDir: string, workspace: string): Promise<WorkspaceGoalsRead> {
  const resolved = resolve(workspace);
  const directory = join(goalsRoot(agentDir), workspaceKey(resolved));
  try {
    const names = await listOrMissing(files, directory);
    return { state: "ready", ...await readGoalsIn(files, directory, names ?? [], resolved) };
  } catch (error) {
    return { state: "failed", directory: resolved, error: describeError(error) };
  }
}

async function describedWorkspace(files: GoalFiles, directory: string, key: string): Promise<string | undefined> {
  try {
    const workspace: unknown = Reflect.get(Object(JSON.parse(await files.readFile(join(directory, WORKSPACE_FILE)))), "workspace");
    return typeof workspace === "string" && workspace !== "" && workspaceKey(workspace) === key ? resolve(workspace) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Every workspace pi-goal stored goals for, as pi-goal's own "All goals" scope finds them: each
 * directory whose `workspace.json` names a path hashing to the directory's name. Directories that
 * do not are counted as skipped, never guessed at.
 */
export async function readAllGoals(files: GoalFiles, agentDir: string): Promise<AllGoalsRead> {
  const root = goalsRoot(agentDir);
  try {
    const keys = ((await listOrMissing(files, root)) ?? []).filter((name) => WORKSPACE_KEY.test(name)).sort();
    const workspaces: WorkspaceGoals[] = [];
    let skippedWorkspaces = 0;
    for (const key of keys) {
      const directory = join(root, key);
      const workspace = await describedWorkspace(files, directory, key);
      const names = workspace === undefined ? undefined : await listOrMissing(files, directory).catch(() => undefined);
      if (workspace === undefined || names === undefined) {
        skippedWorkspaces += 1;
        continue;
      }
      workspaces.push(await readGoalsIn(files, directory, names, workspace));
    }
    return { state: "ready", workspaces, skippedWorkspaces };
  } catch (error) {
    return { state: "failed", error: describeError(error) };
  }
}
