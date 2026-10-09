import { open, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

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

/** The extension's registry directory, relative to the session's working directory. */
const TASKS_SUBDIR = ".pi/tasks";

/** One background task, as the panel lists it. */
export interface BackgroundTaskInfo {
  readonly id: string;
  readonly name: string;
  readonly command: string;
  /** The tool's own status, except that a running record with a dead process reads "lost". */
  readonly status: string;
  readonly startedAt?: string | undefined;
  readonly endedAt?: string | undefined;
  /** Wall-clock milliseconds: final when finished, elapsed while running. */
  readonly durationMs?: number | undefined;
  readonly exitCode?: number | undefined;
  readonly bytesWritten: number;
  readonly hasOutput: boolean;
}

/**
 * How many of a session's tasks are still running: the running ids in the workspace's registry
 * that the session's transcript started. With none running anywhere, no transcript is read.
 */
export async function runningTasksForSession(cwd: string, transcriptPath: string, probeProcessStart: (pid: number) => Promise<number | undefined>): Promise<number> {
  const running = await runningTaskIds(cwd, probeProcessStart);
  if (running.size === 0) return 0;
  const owned = await ownedTaskIds(cwd, transcriptPath);
  return [...running].filter((id) => owned.has(id)).length;
}

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

/** How far a process's start may sit from the task's own start and still be the task's process. */
const PID_REUSE_TOLERANCE_MS = 60_000;

/** Runs `ps` with these arguments: the host's bounded command helper, so the plugin spawns nothing itself. */
export type RunPs = (args: readonly string[]) => Promise<{ readonly exitCode: number | null; readonly stdout: string }>;

/**
 * When the process behind a pid was born, asked of `ps`; undefined when there is none (`ps` exits
 * non-zero).
 *
 * A task killed by a machine restart keeps `status: "running"` in its file forever, because nothing
 * runs to correct it. Reporting that as running would show a spinner for a task that died days ago,
 * so a running record is only believed while its process exists.
 */
export function processStartProbe(runPs: RunPs): (pid: number) => Promise<number | undefined> {
  return async (pid) => {
    try {
      const { exitCode, stdout } = await runPs(["-p", String(pid), "-o", "lstart="]);
      if (exitCode !== 0) return undefined;
      const born = new Date(stdout.trim()).getTime();
      return Number.isFinite(born) ? born : undefined;
    } catch {
      return undefined;
    }
  };
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

/**
 * Task ids this session started, taken from the output paths in its transcript.
 *
 * The transcript is read incrementally. Its callers run on every recount of a
 * session's background work and every read of its task list, and reading a
 * long-lived session's file in full each time -
 * hundreds of megabytes, regex-swept, per session, every few seconds - was
 * the event-loop stall behind "pi web is always stuck": 67k calls averaging
 * 2.4s each, with everything else queued behind them. A transcript only
 * grows, and bytes already scanned cannot produce new ids, so a watermark
 * per transcript remembers how far the scan got and only the growth is read,
 * with a small overlap so a line torn across the boundary is still seen. A
 * file that shrank was replaced, and is rescanned from the start.
 *
 * The tool reports "Output: .pi/tasks/<dir>/<id>.output" when a task starts, and that line is what
 * lands in the transcript, so the ids are read from it.
 */
export async function taskIdsForSession(transcriptPath: string): Promise<Set<string>> {
  let size: number;
  try {
    size = (await stat(transcriptPath)).size;
  } catch {
    return new Set();
  }
  const state = transcriptScans.get(transcriptPath);
  if (state?.scannedBytes === size) return new Set(state.ids);
  const fromScratch = state === undefined || size < state.scannedBytes;
  const start = fromScratch ? 0 : Math.max(0, state.scannedBytes - SCAN_OVERLAP_BYTES);
  let text: string;
  try {
    text = await readTranscriptSlice(transcriptPath, start, size);
  } catch {
    return new Set(state === undefined ? [] : state.ids);
  }
  const ids = fromScratch ? new Set<string>() : state.ids;
  const pattern = /\.pi[/\\]tasks[/\\][^"'\s]+?[/\\]([A-Za-z0-9_-]+)\.output/g;
  for (const match of text.matchAll(pattern)) {
    const id = match[1];
    if (id !== undefined) ids.add(id);
  }
  if (transcriptScans.size >= SCAN_CACHE_LIMIT && !transcriptScans.has(transcriptPath)) transcriptScans.clear();
  transcriptScans.set(transcriptPath, { scannedBytes: size, ids });
  return new Set(ids);
}

interface TranscriptScanState {
  scannedBytes: number;
  ids: Set<string>;
}

const transcriptScans = new Map<string, TranscriptScanState>();
/** Enough to re-see a task line torn across the previous scan's end. */
const SCAN_OVERLAP_BYTES = 4096;
/** A bound on cached transcripts; overflow rescans once rather than growing forever. */
const SCAN_CACHE_LIMIT = 500;

/** Tests reset the watermark cache so each fixture starts unseen. */
export function resetTranscriptScanCache(): void {
  transcriptScans.clear();
}

async function readTranscriptSlice(path: string, start: number, end: number): Promise<string> {
  if (end <= start) return "";
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(end - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    await handle.close();
  }
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

/**
 * Atomic replace, so a read landing mid-write cannot hand back a torn file. A failed write costs only
 * durability until the next sighting records again; it never fails the read that keeps it.
 */
async function writeAttributions(cwd: string, attributions: Map<string, string>): Promise<void> {
  const path = attributionPath(cwd);
  const staged = `${path}.${String(process.pid)}.tmp`;
  try {
    await writeFile(staged, JSON.stringify(Object.fromEntries(attributions), null, 2));
    await rename(staged, path);
  } catch {
    return;
  }
}

/**
 * Parsed registry files, reused while their stat is unchanged. The registry
 * accumulates hundreds of records, almost all of them finished tasks whose
 * files will never change again; re-reading and re-parsing every one of them
 * on every poll was the cost that remained after the transcript watermark.
 * An unchanged size and mtime answers from the cache; anything else re-reads.
 */
interface CachedTaskRecord {
  sizeBytes: number;
  mtimeMs: number;
  task: StoredTask;
}

const taskRecordCache = new Map<string, CachedTaskRecord>();
const TASK_RECORD_CACHE_LIMIT = 5000;

/** Tests reset the cache so each fixture starts unseen. */
export function resetTaskRecordCache(): void {
  taskRecordCache.clear();
}

/**
 * One registry file, parsed. A file torn mid-write, or whose writer crashed before it was parsed, is
 * held as an empty record and not cached, so the next read sees it once the writer finishes. Every
 * consumer reads fields through asString/asNumber, so an empty record is safe: it claims no running
 * process and lists as status "unknown" under the identity anyone can prove, the file name. Dropping
 * it instead answered "this session never started anything" for a task the reader had started.
 */
async function readTaskRecordFile(full: string): Promise<StoredTask | undefined> {
  let sizeBytes: number;
  let mtimeMs: number;
  try {
    const info = await stat(full);
    sizeBytes = info.size;
    mtimeMs = info.mtimeMs;
  } catch {
    return undefined;
  }
  const cached = taskRecordCache.get(full);
  if (cached?.sizeBytes === sizeBytes && cached.mtimeMs === mtimeMs) return cached.task;
  let task: StoredTask;
  try {
    const parsed: unknown = JSON.parse(await readFile(full, "utf8"));
    task = typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
  if (taskRecordCache.size >= TASK_RECORD_CACHE_LIMIT && !taskRecordCache.has(full)) taskRecordCache.clear();
  taskRecordCache.set(full, { sizeBytes, mtimeMs, task });
  return task;
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
      const task = await readTaskRecordFile(full);
      if (task === undefined) continue;
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
  probeProcessStart: (pid: number) => Promise<number | undefined>,
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

/**
 * The task ids a session owns. What its transcript proves is recorded first, then ownership
 * is read from the record. The key is the transcript's base name, the one session identity this
 * reader is handed; first writer wins, so a session that quotes another's output path cannot
 * claim a task it did not start, and the record outvotes a quoted mention.
 */
async function ownedTaskIds(cwd: string, transcriptPath: string): Promise<Set<string>> {
  const ids = await taskIdsForSession(transcriptPath);
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
    else owned.delete(id);
  }
  return owned;
}

/**
 * A session's tasks, newest first, the one someone opened the panel to check being the recent one.
 *
 * A "running" record whose process is gone died without being able to record it (a restart, an
 * OOM kill) and is reported as lost rather than spinning forever. Only a running record is probed:
 * spawning `ps` for every finished task ever recorded, on every read, was a process storm for
 * answers that cannot change.
 */
export async function listBackgroundTasks(
  cwd: string,
  transcriptPath: string,
  now: number,
  probeProcessStart: (pid: number) => Promise<number | undefined>,
): Promise<BackgroundTaskInfo[]> {
  const [owned, records] = await Promise.all([ownedTaskIds(cwd, transcriptPath), readTaskRecords(cwd)]);
  const tasks: BackgroundTaskInfo[] = [];
  for (const id of owned) {
    const record = records.get(id);
    if (record === undefined) continue;
    const { task } = record;
    const rawStatus = asString(task.status) ?? "unknown";
    const pid = asNumber(task.pid);
    const startedAt = asNumber(task.startTime);
    const endedAt = asNumber(task.endTime);
    const alive = rawStatus === "running"
      && pid !== undefined
      && taskProcessIsOriginal(await probeProcessStart(pid), pid, startedAt);
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
  tasks.sort((left, right) => (right.startedAt ?? "").localeCompare(left.startedAt ?? ""));
  return tasks;
}
