import type { BackgroundWorkSession } from "../../../server-plugin-api.js";
import { runningTaskIds, taskIdsForSession } from "./backgroundTasks.js";

/**
 * How much work a session still has in flight after its own turn has ended.
 *
 * The chat already tells this story ("idle · 1 background run"), but it tells
 * it from per-session reads the browser only makes for the session it is
 * showing. Every other surface — the session list, the quick switcher — had no
 * way to know, so a session with a subagent still thinking was painted with
 * the same grey dot as one with nothing left to do.
 *
 * Core counts what core owns: spawned subsessions that are working and
 * background shell tasks that are running. Everything else is what the
 * running plugins report (`backgroundWork`, B20): the Subagents plugin counts
 * its tool runs, and with it turned off they stop counting.
 */
export interface BackgroundRunCountInput {
  sessionId: string;
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
  /** The runs the running plugins report for the session, added together. */
  pluginBackgroundWork: (session: BackgroundWorkSession) => Promise<number>;
}

/** Core's own probes of the background shell tasks; the plugins' share is the caller's to supply. */
export const backgroundTaskProbes: Pick<BackgroundRunCountDeps, "runningTaskIds" | "taskIdsForSession"> = { runningTaskIds, taskIdsForSession };

export interface BackgroundRunCountCycle {
  count(input: BackgroundRunCountInput): Promise<number>;
}
/**
 * Build the counter used by one heartbeat pass.
 *
 * Task registries belong to a workspace, while the answers produced from them
 * belong to individual sessions. This cycle shares the per-workspace
 * running-task snapshot across the sessions of one pass without retaining it
 * across heartbeats, so process liveness is still refreshed on the next pass.
 * The plugins' share is asked fresh for each session.
 */
export function createBackgroundRunCountCycle(deps: BackgroundRunCountDeps): BackgroundRunCountCycle {
  const runningTasksByCwd = new Map<string, Promise<Set<string>>>();
  const cycleDeps: BackgroundRunCountDeps = {
    ...deps,
    runningTaskIds: (cwd) => {
      let running = runningTasksByCwd.get(cwd);
      if (running === undefined) {
        running = deps.runningTaskIds(cwd);
        runningTasksByCwd.set(cwd, running);
      }
      return running;
    },
  };
  return { count: (input) => countBackgroundRuns(input, cycleDeps) };
}

export async function countBackgroundRuns(
  input: BackgroundRunCountInput,
  deps: BackgroundRunCountDeps,
): Promise<number> {
  const { sessionFile } = input;
  if (sessionFile === undefined) return input.workingSubsessionCount;
  const [tasks, pluginRuns] = await Promise.all([
    countRunningTasks(input.cwd, sessionFile, deps),
    deps.pluginBackgroundWork({ sessionId: input.sessionId, cwd: input.cwd, sessionFile, parentActive: input.parentActive }),
  ]);
  return input.workingSubsessionCount + tasks + pluginRuns;
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

