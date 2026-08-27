import { readdir, readFile, stat } from "node:fs/promises";
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
function processAlive(pid: number | undefined): boolean {
  if (pid === undefined) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else, which still
    // counts as alive; only ESRCH means it is gone.
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
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
      try {
        const parsed: unknown = JSON.parse(await readFile(full, "utf8"));
        if (typeof parsed !== "object" || parsed === null) continue;
        // Every field is read through asString/asNumber below, so an unknown
        // record is safe to hold as one: nothing here trusts its shape.
        const task: StoredTask = parsed;
        const id = asString(task.id) ?? basename(file, ".json");
        records.set(id, { task, file: full });
      } catch {
        // A record being written right now is skipped, not fatal: the next
        // poll picks it up.
        continue;
      }
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
export async function runningTaskIds(cwd: string): Promise<Set<string>> {
  const running = new Set<string>();
  for (const [id, record] of await readTaskRecords(cwd)) {
    if (asString(record.task.status) !== "running") continue;
    if (!processAlive(asNumber(record.task.pid))) continue;
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
): Promise<SessionBackgroundTaskInfo[]> {
  const [ids, records] = await Promise.all([taskIdsForSession(transcriptPath), readTaskRecords(cwd)]);
  const tasks: SessionBackgroundTaskInfo[] = [];
  for (const id of ids) {
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
    const status = rawStatus === "running" && !processAlive(pid) ? "lost" : rawStatus;
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
