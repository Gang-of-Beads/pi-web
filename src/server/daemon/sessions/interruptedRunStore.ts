import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { piWebDataDir } from "../../../config.js";

/**
 * Remembering which runs a restart cut off.
 *
 * The record is written when a run *starts* and removed when it ends, so
 * whatever remains is exactly what did not finish. Writing it during shutdown
 * does not work: the daemon runs under systemd's default
 * KillMode=control-group, so SIGTERM reaches the agent subprocesses at the same
 * instant as the daemon itself. The run the drain exists to protect is already
 * dead by the time the drain looks, so it waits for nothing and a
 * shutdown-time record records nothing -- observed as "shutting down" and
 * "Stopped" in the same second, with no drain line at all.
 *
 * Marking at the start costs a small write per run and, unlike a shutdown hook,
 * also survives SIGKILL, a crash, and the power going out.
 *
 * A drain can only ever be bounded — systemd's own `TimeoutStopSec` is 90s on
 * this deployment, after which it sends SIGKILL no matter what the daemon
 * wants — so no timeout is long enough for a genuinely long agent run. The
 * honest answer is not a bigger number but a record: if a restart had to
 * interrupt work, say so afterwards instead of letting it vanish.
 *
 * The record exists to be shown and then cleared. It deliberately holds only
 * what is needed to find the session again, because it is written during
 * shutdown, when the process may be seconds from being killed.
 */

export interface InterruptedRun {
  sessionId: string;
  cwd: string;
  /** When the interrupting shutdown happened, ISO. */
  interruptedAt: string;
}

export interface InterruptedRunRecord {
  runs: InterruptedRun[];
}

const EMPTY: InterruptedRunRecord = { runs: [] };

export function defaultInterruptedRunFilePath(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): string {
  return join(piWebDataDir(env, cwd), "interrupted-runs.json");
}

/**
 * Persist the runs a shutdown interrupted.
 *
 * Overwrites rather than appends: the record answers "what did the last restart
 * cut off", and an ever-growing list of historical interruptions is noise the
 * user would have to clear repeatedly.
 *
 * Never throws. This runs during shutdown, and failing to write a convenience
 * record must not stop the daemon exiting.
 */
export async function recordInterruptedRuns(
  runs: readonly InterruptedRun[],
  filePath: string = defaultInterruptedRunFilePath(),
): Promise<void> {
  try {
    if (runs.length === 0) {
      await writeFile(filePath, `${JSON.stringify(EMPTY, null, 2)}\n`, "utf8");
      return;
    }
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify({ runs: [...runs] }, null, 2)}\n`, "utf8");
  } catch {
    // Shutdown continues regardless.
  }
}

/**
 * Read the record left by the previous shutdown.
 *
 * A missing or unreadable file means "nothing was interrupted", which is both
 * the common case and the safe reading: inventing interruptions would send the
 * user chasing work that finished normally.
 */
export async function readInterruptedRuns(
  filePath: string = defaultInterruptedRunFilePath(),
): Promise<InterruptedRunRecord> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return EMPTY;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return { runs: parseRuns(parsed) };
  } catch {
    return EMPTY;
  }
}

/** Clear the record once the user has seen it. */
export async function clearInterruptedRuns(
  filePath: string = defaultInterruptedRunFilePath(),
): Promise<void> {
  await recordInterruptedRuns([], filePath);
}

function parseRuns(value: unknown): InterruptedRun[] {
  const root = asRecord(value);
  const runs = root?.["runs"];
  if (!Array.isArray(runs)) return [];
  const parsed: InterruptedRun[] = [];
  for (const entry of runs) {
    const record = asRecord(entry);
    if (record === undefined) continue;
    const sessionId = record["sessionId"];
    const cwd = record["cwd"];
    if (typeof sessionId !== "string" || sessionId === "") continue;
    if (typeof cwd !== "string" || cwd === "") continue;
    const interruptedAt = record["interruptedAt"];
    parsed.push({ sessionId, cwd, interruptedAt: typeof interruptedAt === "string" ? interruptedAt : "" });
  }
  return parsed;
}

/** Narrow an unknown to a plain object without asserting a shape onto it. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) result[key] = entry;
  return result;
}

/** Where the live set of in-flight runs is kept. */
export function defaultInFlightRunFilePath(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): string {
  return join(piWebDataDir(env, cwd), "in-flight-runs.json");
}

/**
 * Note that a run has started.
 *
 * Never throws: failing to write a convenience record must not fail the run it
 * is describing.
 */
export async function markRunInFlight(
  run: { sessionId: string; cwd: string },
  filePath: string = defaultInFlightRunFilePath(),
): Promise<void> {
  try {
    const current = await readRuns(filePath);
    if (current.some((entry) => entry.sessionId === run.sessionId)) return;
    await writeRuns([...current, { ...run, interruptedAt: new Date().toISOString() }], filePath);
  } catch {
    // The run proceeds regardless.
  }
}

/** Note that a run finished, so it is not reported as interrupted. */
export async function clearRunInFlight(
  sessionId: string,
  filePath: string = defaultInFlightRunFilePath(),
): Promise<void> {
  try {
    const current = await readRuns(filePath);
    const next = current.filter((entry) => entry.sessionId !== sessionId);
    if (next.length === current.length) return;
    await writeRuns(next, filePath);
  } catch {
    // Leaving a stale entry only risks over-reporting, which the user can dismiss.
  }
}

/**
 * Read what the previous process left behind and clear it.
 *
 * Called once at startup: anything still marked in flight belongs to a process
 * that is gone, so it did not finish. Clearing as part of reading means a
 * restart cannot report the same interruption forever.
 */
export async function takeInterruptedRuns(
  filePath: string = defaultInFlightRunFilePath(),
): Promise<InterruptedRun[]> {
  const runs = await readRuns(filePath);
  if (runs.length > 0) await writeRuns([], filePath);
  return runs;
}

async function readRuns(filePath: string): Promise<InterruptedRun[]> {
  try {
    return parseRuns(JSON.parse(await readFile(filePath, "utf8")));
  } catch {
    return [];
  }
}

async function writeRuns(runs: readonly InterruptedRun[], filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify({ runs: [...runs] }, null, 2)}\n`, "utf8");
}
