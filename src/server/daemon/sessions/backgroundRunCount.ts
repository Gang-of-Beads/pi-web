import { basename, dirname } from "node:path";
import type { SessionSubagentRunInfo } from "../../../shared/apiTypes.js";
import { runningTaskIds, taskIdsForSession } from "./backgroundTasks.js";
import { createSubagentRunLister, listSubagentRuns } from "./subagentRuns.js";

/**
 * How much work a session still has in flight after its own turn has ended.
 *
 * The chat already tells this story ("idle · 1 background run"), but it tells
 * it from three per-session reads the browser only makes for the session it is
 * showing. Every other surface — the session list, the quick switcher — had no
 * way to know, so a session with a subagent still thinking was painted with
 * the same grey dot as one with nothing left to do.
 *
 * Counted the same three ways the chat counts, so the two cannot disagree:
 * spawned subsessions that are working, subagent-tool runs that are running,
 * and background shell tasks that are running.
 */
export interface BackgroundRunCountInput {
  cwd: string;
  /** Absent for a session with no transcript yet; it can own nothing on disk. */
  sessionFile: string | undefined;
  /** Whether the parent turn is still streaming; decides what a silent run means. */
  parentActive: boolean;
  /** Working spawned subsessions, which the daemon already tracks in memory. */
  workingSubsessionCount: number;
}

export interface BackgroundRunCountDeps {
  runningTaskIds: (cwd: string) => Promise<Set<string>>;
  taskIdsForSession: (transcriptPath: string) => Promise<Set<string>>;
  listSubagentRuns: (
    sessionDir: string,
    parentSessionId: string,
    now?: number,
    options?: { parentActive?: boolean },
  ) => Promise<SessionSubagentRunInfo[]>;
}

const defaultDeps: BackgroundRunCountDeps = { runningTaskIds, taskIdsForSession, listSubagentRuns };

export interface BackgroundRunCountCycle {
  count(input: BackgroundRunCountInput): Promise<number>;
}

/**
 * Build the counter used by one heartbeat pass.
 *
 * Task registries belong to a workspace and subagent artifacts belong to a
 * session directory, while the answers produced from them belong to individual
 * sessions. This cycle shares those broad snapshots without retaining them
 * across heartbeats, so process liveness and newly written artifacts are still
 * refreshed on the next pass.
 */
export function createBackgroundRunCountCycle(deps?: BackgroundRunCountDeps): BackgroundRunCountCycle {
  const effectiveDeps = deps ?? { ...defaultDeps, listSubagentRuns: createSubagentRunLister() };
  const runningTasksByCwd = new Map<string, Promise<Set<string>>>();
  const cycleDeps: BackgroundRunCountDeps = {
    ...effectiveDeps,
    runningTaskIds: (cwd) => {
      let running = runningTasksByCwd.get(cwd);
      if (running === undefined) {
        running = effectiveDeps.runningTaskIds(cwd);
        runningTasksByCwd.set(cwd, running);
      }
      return running;
    },
  };
  return { count: (input) => countBackgroundRuns(input, cycleDeps) };
}

export async function countBackgroundRuns(
  input: BackgroundRunCountInput,
  deps: BackgroundRunCountDeps = defaultDeps,
): Promise<number> {
  const { sessionFile } = input;
  if (sessionFile === undefined) return input.workingSubsessionCount;
  const [tasks, toolRuns] = await Promise.all([
    countRunningTasks(input.cwd, sessionFile, deps),
    countRunningToolRuns(sessionFile, input.parentActive, deps),
  ]);
  return input.workingSubsessionCount + tasks + toolRuns;
}

async function countRunningTasks(cwd: string, sessionFile: string, deps: BackgroundRunCountDeps): Promise<number> {
  const running = await deps.runningTaskIds(cwd);
  // No task is running anywhere in this workspace, so no transcript needs
  // reading to learn that none of them belongs to this session.
  if (running.size === 0) return 0;
  const owned = await deps.taskIdsForSession(sessionFile);
  let count = 0;
  for (const id of running) {
    if (owned.has(id)) count += 1;
  }
  return count;
}

async function countRunningToolRuns(sessionFile: string, parentActive: boolean, deps: BackgroundRunCountDeps): Promise<number> {
  const runs = await deps.listSubagentRuns(dirname(sessionFile), basename(sessionFile, ".jsonl"), Date.now(), { parentActive });
  return runs.filter((run) => run.status === "running").length;
}
