import type { BackgroundWorkSession } from "../../../server-plugin-api.js";

/**
 * How much work a session still has in flight after its own turn has ended.
 *
 * The chat already tells this story ("idle · 1 background run"), but it tells
 * it from per-session reads the browser only makes for the session it is
 * showing. Every other surface — the session list, the quick switcher — had no
 * way to know, so a session with background work still running was painted with
 * the same grey dot as one with nothing left to do.
 *
 * Core counts what core owns: the spawned subsessions that are working. Every
 * other run is what the running plugins report (`backgroundWork`, B20): the
 * Subagents plugin counts its tool runs, Background runs its shell tasks, and
 * a plugin turned off stops counting.
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
  /** The runs the running plugins report for the session, added together. */
  pluginBackgroundWork: (session: BackgroundWorkSession) => Promise<number>;
}

export async function countBackgroundRuns(
  input: BackgroundRunCountInput,
  deps: BackgroundRunCountDeps,
): Promise<number> {
  const { sessionFile } = input;
  if (sessionFile === undefined) return input.workingSubsessionCount;
  const pluginRuns = await deps.pluginBackgroundWork({ sessionId: input.sessionId, cwd: input.cwd, sessionFile, parentActive: input.parentActive });
  return input.workingSubsessionCount + pluginRuns;
}
