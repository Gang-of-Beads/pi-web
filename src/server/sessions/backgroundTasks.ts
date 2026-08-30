import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { SessionBackgroundTaskInfo } from "../../shared/apiTypes.js";

/**
 * Background-task runs, read from the registry the task tool leaves on disk.
 *
 * The tool is a pi extension that runs a shell command outside the turn that
 * started it, and it reports progress to the terminal UI only. In a browser
 * the work was therefore invisible: a deploy could run for ten minutes with
 * nothing on screen, which is exactly when someone wants to look.
 *
 * Attribution is the interesting part. The tool names its directory
 *
 *   <cwd>/.pi/tasks/<sessionId ?? "session-<pid>">-<pid>/<taskId>.json
 *
 * and nothing ever supplies that sessionId (BackgroundTaskContext declares it
 * optional and every construction site omits it), so the name collapses to the
 * pid of the *server* process. One PI WEB server hosts every session, so all
 * sessions share one directory and the records carry no session field. Reading
 * that directory alone would show every session the same list.
 *
 * So the directory supplies the state and the transcript supplies the
 * ownership: a task belongs to the session whose transcript mentions its
 * output path, which the tool writes into its own result when the task starts.
 * That is exact, survives a restart, and needs no cooperation from the tool.
 *
 * But the transcript's proof is perishable: compaction rewrites the session
 * file and the Output lines are exactly what it deletes, so a task that ran
 * longer than one compaction cycle lost its owner and vanished from every
 * list. Ownership that was observed is therefore recorded, once, in a durable
 * per-workspace file beside the registry, and later lists attribute from the
 * record. First writer wins: a session that merely quotes another session's
 * output path must not be able to claim its task.
 */

/** A record claiming to run whose process is gone is reported as it is, not as running. */
const TASKS_SUBDIR = join(".pi", "tasks");
/** Enough of the tail to show what a task is doing without reading a long log. */
const TAIL_BYTES = 16 * 1024;

interface StoredTask {
  id?: unknown;
  name?: unknown;
  command?: unknown;
  status?: unknown;
  outputPath?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  exitCode?: unknown;
  pid?: unknown;
  bytesWritten?: unknown;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Whether a process is still alive.
 *
 * A task killed by a machine restart keeps `status: "running"` in its file
 * forever, because nothing runs to correct it. Reporting that as running would
 * mean the UI shows a spinner for a task that died days ago, so a running
 * record is only believed while its process exists.
 */
const PID_REUSE_TOLERANCE_MS = 60_000;

const execFileAsync = promisify(execFile);

/** When the process behind `pid` was born, or undefined if there is none. */
async function processStartMs(pid: number | undefined): Promise<number | undefined> {
  if (pid === undefined) return undefined;
  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "lstart="]);
    const born = new Date(stdout.trim()).getTime();
    return Number.isFinite(born) ? born : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a pid still belongs to the task's own process.
 *
 * Operating systems recycle pids within days: measured live, a web server
 * task that died on August 24 still reported running on August 29 because pid
 * 69946 had been handed to /usr/libexec/microstackshot. A process's start
 * time is its identity: the task's own process started when the task started
 * (exec does not reset it), so a start time more than a minute later belongs
 * to whoever inherited the number. No probe result at all means the process
 * is gone.
 */
export function taskProcessIsOriginal(
  startMs: number | undefined,
  pid: number | undefined,
  startedAtMs: number | undefined,
): boolean {
  if (pid === undefined) return false;
  if (startMs === undefined) return false;
  if (startedAtMs === undefined) return true;
  return Math.abs(startMs - startedAtMs) <= PID_REUSE_TOLERANCE_MS;
}

/** Task ids this session started, taken from the output paths in its transcript. */
export async function taskIdsForSession(transcriptPath: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let text: string;
  try {
    text = await readFile(transcriptPath, "utf8");
  } catch {
    return ids;
  }
  // The tool reports "Output: .pi/tasks/<dir>/<id>.output" when a task starts,
  // and that line is what lands in the transcript.
  const pattern = /\.pi[/\\]tasks[/\\][^"'\s]+?[/\\]([A-Za-z0-9_-]+)\.output/g;
  for (const match of text.matchAll(pattern)) {
    const id = match[1];
    if (id !== undefined) ids.add(id);
  }
  return ids;
}

/**
 * Ownership that was proven once, kept forever: taskId → transcript file name.
 *
 * The file lives beside the registry it describes, which is gitignored runtime
 * state ({@link TASKS_SUBDIR} is already ignored), and is keyed by the
 * transcript's base name — the one identity this reader is handed. A missing
 * or unreadable file means nothing was recorded yet, not an error: the
 * transcript scan still works, and the next sighting re-records.
 */
function attributionPath(cwd: string): string {
  return join(cwd, TASKS_SUBDIR, "attribution.json");
}

async function readAttributions(cwd: string): Promise<Map<string, string>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(attributionPath(cwd), "utf8"));
    const attributions = new Map<string, string>();
    if (typeof parsed !== "object" || parsed === null) return attributions;
    for (const [id, owner] of Object.entries(parsed)) {
      const ownerFile = asString(owner);
      if (id !== "" && ownerFile !== undefined) attributions.set(id, ownerFile);
    }
    return attributions;
  } catch {
    return new Map();
  }
}

/** Atomic replace, so a poll landing mid-write cannot hand back a torn file. */
async function writeAttributions(cwd: string, attributions: Map<string, string>): Promise<void> {
  const path = attributionPath(cwd);
  const staged = `${path}.${String(process.pid)}.tmp`;
  try {
    await writeFile(staged, JSON.stringify(Object.fromEntries(attributions), null, 2));
    await rename(staged, path);
  } catch {
    // A failed write costs only durability until the next sighting re-records;
    // it must never fail the list that was trying to maintain it.
  }
}

/** Every task record under a workspace, regardless of which session started it. */
export async function readTaskRecords(cwd: string): Promise<Map<string, { task: StoredTask; file: string }>> {
  const root = join(cwd, TASKS_SUBDIR);
  const records = new Map<string, { task: StoredTask; file: string }>();
  let dirs: string[];
  try {
    dirs = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return records;
  }
  for (const dir of dirs) {
    let files: string[];
    try {
      files = (await readdir(join(root, dir))).filter((name) => name.endsWith(".json"));
    } catch {
      continue;
    }
    for (const file of files) {
      const full = join(root, dir, file);
      // Every consumer reads fields through asString/asNumber, so an unreadable
      // body is safe to hold as an empty record: runningTaskIds skips anything
      // without status "running" (an unreadable record claims no process), and
      // listBackgroundTasks renders it as status "unknown" under the identity
      // anyone can actually prove - the filename. Dropping it instead answered
      // "this session never started anything" for a task the reader had
      // started, which is how a running task vanished from the panel.
      const unreadable: StoredTask = {};
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(full, "utf8"));
      } catch {
        // Torn mid-write or crashed before parsing: reported as unknown, and
        // the next poll re-reads it once the writer finishes.
        const id = basename(file, ".json");
        records.set(id, { task: unreadable, file: full });
        continue;
      }
      if (typeof parsed !== "object" || parsed === null) {
        const id = basename(file, ".json");
        records.set(id, { task: unreadable, file: full });
        continue;
      }
      const task: StoredTask = parsed;
      const id = asString(task.id) ?? basename(file, ".json");
      records.set(id, { task, file: full });
    }
  }
  return records;
}

/**
 * Ids of task records under this workspace whose process is running right now,
 * regardless of which session started them.
 *
 * Deliberately cheap: the registry files are small, and the answer is almost
 * always the empty set. Only a non-empty answer justifies reading a transcript
 * to find out which session owns the task, which is the expensive half of
 * {@link listBackgroundTasks} and far too costly to repeat on a timer.
 */
export async function runningTaskIds(
  cwd: string,
  probeProcessStart: (pid: number) => Promise<number | undefined> = processStartMs,
): Promise<Set<string>> {
  const running = new Set<string>();
  for (const [id, record] of await readTaskRecords(cwd)) {
    if (asString(record.task.status) !== "running") continue;
    const pid = asNumber(record.task.pid);
    if (pid === undefined) continue;
    if (!taskProcessIsOriginal(await probeProcessStart(pid), pid, asNumber(record.task.startTime))) continue;
    running.add(id);
  }
  return running;
}

/** The tail of a task's log, for showing what it is doing without opening a file. */
export async function readTaskOutput(cwd: string, taskId: string, maxBytes = TAIL_BYTES): Promise<string | undefined> {
  const records = await readTaskRecords(cwd);
  const record = records.get(taskId);
  const outputPath = record === undefined ? undefined : asString(record.task.outputPath);
  if (outputPath === undefined) return undefined;
  const absolute = outputPath.startsWith("/") ? outputPath : join(cwd, outputPath);
  try {
    const info = await stat(absolute);
    const handle = await readFile(absolute, "utf8");
    return info.size > maxBytes ? handle.slice(-maxBytes) : handle;
  } catch {
    return undefined;
  }
}

export async function listBackgroundTasks(
  cwd: string,
  transcriptPath: string,
  now = Date.now(),
  probeProcessStart: (pid: number) => Promise<number | undefined> = processStartMs,
): Promise<SessionBackgroundTaskInfo[]> {
  const [ids, records] = await Promise.all([taskIdsForSession(transcriptPath), readTaskRecords(cwd)]);
  // Record what this transcript just proved, then attribute from the record.
  // The key is the transcript's base name, the one session identity this reader
  // is handed; first writer wins, so a session that quotes another's output
  // path cannot claim a task it did not start.
  const session = basename(transcriptPath);
  const attributions = await readAttributions(cwd);
  let recorded = false;
  for (const id of ids) {
    if (!attributions.has(id)) {
      attributions.set(id, session);
      recorded = true;
    }
  }
  if (recorded) await writeAttributions(cwd, attributions);
  const owned = new Set(ids);
  for (const [id, owner] of attributions) {
    if (owner === session) owned.add(id);
    else owned.delete(id); // the record outvotes a quoted mention
  }
  const tasks: SessionBackgroundTaskInfo[] = [];
  for (const id of owned) {
    const record = records.get(id);
    if (record === undefined) continue;
    const { task } = record;
    const rawStatus = asString(task.status) ?? "unknown";
    const pid = asNumber(task.pid);
    const startedAt = asNumber(task.startTime);
    const endedAt = asNumber(task.endTime);

    // A "running" record whose process is gone died without being able to
    // record it - a restart, an OOM kill - and is reported as lost rather than
    // spinning forever.
    const alive =
      pid !== undefined && taskProcessIsOriginal(await probeProcessStart(pid), pid, startedAt);
    const status = rawStatus === "running" && !alive ? "lost" : rawStatus;
    tasks.push({
      id,
      name: asString(task.name) ?? id,
      command: asString(task.command) ?? "",
      status,
      startedAt: startedAt === undefined ? undefined : new Date(startedAt).toISOString(),
      endedAt: endedAt === undefined ? undefined : new Date(endedAt).toISOString(),
      durationMs: startedAt === undefined ? undefined : (endedAt ?? now) - startedAt,
      exitCode: asNumber(task.exitCode),
      bytesWritten: asNumber(task.bytesWritten) ?? 0,
      hasOutput: asString(task.outputPath) !== undefined,
    });
  }
  // Newest first: the task someone opened the page to check is the recent one.
  tasks.sort((left, right) => (right.startedAt ?? "").localeCompare(left.startedAt ?? ""));
  return tasks;
}
