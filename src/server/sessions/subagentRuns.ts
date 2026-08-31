import { open, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { SessionSubagentRunInfo } from "../../shared/apiTypes.js";

/**
 * Subagent-tool runs, read from the layout the tool leaves behind.
 *
 * A run is not a session, which is why none of this shows up anywhere else in
 * the UI: the agent sessions directory lists `*.jsonl` files at its top level,
 * and a subagent run writes into subdirectories instead -
 *
 *   <sessionDir>/<parentSessionId>/<runId>/run-N/session.jsonl   (live)
 *   <sessionDir>/subagent-artifacts/<runId>_<agent>_<n>_meta.json (finished)
 *
 * A child that runs in a fork of the parent context is the exception: it writes
 * its transcript to <sessionDir>/<parentSessionId>/forks/<timestamp>_<id>.jsonl
 * and leaves its own run directory empty until it finishes. Nothing in that
 * file names the run it belongs to - the header carries only the parent
 * session's path, and its `session_info` name is the parent's name - so such a
 * run is reported from its directory alone and shows the generic agent name
 * until an artifact lands. That is worth it: the alternative was being absent
 * from the list for the whole time it was working.
 *
 * Attribution is by recorded fact, never by timing. Two records exist: a run
 * directory under <sessionDir>/<parentSessionFile>/, and the spawn the parent
 * wrote into its own transcript. The shared artifacts directory records no
 * owner at all, so it supplies detail about runs this session already owns and
 * never membership - see `runIdsNamedByParent` for the measurements.
 *
 * So the parent conversation could not say what its children were doing, or
 * even that it had any. Reading the directory is deliberate rather than
 * subscribing to the tool: the tool is an extension that may not be installed,
 * its runs outlive the turn that started them, and the files are what survives
 * a server restart.
 */

/**
 * How long a run with no artifact may stay silent before it is presumed gone,
 * when nothing better is known.
 *
 * Only a fallback: a child writes its transcript when it calls a tool, and a
 * reviewer reading a long document can think for far longer than this between
 * calls. Judging liveness by file mtime alone therefore declared exactly the
 * runs worth watching - the slow, careful ones - dead. Whether the parent turn
 * is still running is a fact rather than a guess, so it wins when available.
 */
const RUNNING_STALE_AFTER_MS = 10 * 60 * 1000;
/** Measured on a real session: live children were quiet under a minute, dead ones 139+. */
const PARENT_ACTIVE_STALE_AFTER_MS = 30 * 60 * 1000;
/**
 * How long a run that has written nothing at all may still be explained by
 * "it only just started".
 *
 * A run directory with no transcript and no artifact has no evidence of its own
 * about whether the child lives, so the parent is asked instead. But the parent
 * streaming is a fact about the *parent*: it says a conversation is busy now,
 * not that some particular child spawned hours ago is the one keeping it busy.
 * Left unbounded, that inference read six directories abandoned by children
 * that died before writing - empty for 158, 218, 230, 231, 274 and 274 minutes
 * - as agents still working, and the drawer offered them for hours under the
 * generic name, with no output and nothing to open.
 *
 * The bound is the run's own age, because a child that is genuinely mid-launch
 * is young. Measured across 198 real runs on this machine, the gap between a
 * run directory being created and its first transcript line appearing was a
 * median of 7s, a 95th percentile of 28s and a maximum of 55s. Five minutes is
 * an order of magnitude beyond the slowest observed start, so a child still
 * silent past it did not start slowly - it never started. That also keeps this
 * the tightest of the three windows here, below RUNNING_STALE_AFTER_MS, which
 * is right: those two judge a child that has proved it can write, and this one
 * judges a child that has never written at all.
 */
const SILENT_LAUNCH_GRACE_MS = 5 * 60 * 1000;
/** Enough of the tail to find the last step without reading a long transcript. */
const TAIL_BYTES = 64 * 1024;
/** The session header records sit in the first few lines of a transcript. */
const HEAD_BYTES = 8 * 1024;
/** A result's first line is its row label; the rest of the document is not read. */
const OUTPUT_HEAD_BYTES = 8 * 1024;

/**
 * A window of a file, read as a window.
 *
 * Every caller here wants a few kilobytes of a file that can be megabytes, and
 * each of them used to ask for the whole thing and then slice the part it
 * wanted - which reads the file into memory first, so the slice saved nothing.
 * One open session with 129 finished runs made that 170MB of reads on every
 * four-second poll, and the activity list fell so far behind that it looked
 * frozen until the reader reloaded the page.
 */
async function readWindow(path: string, bytes: number, edge: "head" | "tail"): Promise<string | undefined> {
  let handle;
  try {
    handle = await open(path, "r");
    const { size } = await handle.stat();
    const length = Math.min(size, bytes);
    if (length === 0) return "";
    const buffer = Buffer.alloc(length);
    const position = edge === "head" ? 0 : size - length;
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

interface RunArtifact {
  agent?: string;
  task?: string;
  outputSummary?: string;
  model?: string;
  exitCode?: number;
  durationMs?: number;
  toolCount?: number;
  timestamp?: string;
  hasOutput: boolean;
  /**
   * Set only once the run wrote its `meta.json`, which the tool does when the
   * run ends. The other artifacts - the prompt it was given and the transcript
   * it is filling in - appear at launch, so their presence says a run exists,
   * never that it is over.
   */
  reported: boolean;
}

/**
 * What the artifacts directory knows about a run before it has reported.
 *
 * A run writes `<runId>_<agent>_<n>_input.md` and `_transcript.jsonl` when it
 * starts and `_meta.json` only when it finishes, so these two are the only
 * trace a running fork child leaves under its own id. The transcript's mtime
 * is the one live signal in the layout: the child appends to it as it works.
 */
interface RunningArtifact {
  agent?: string;
  transcriptPath: string;
  lastWriteMs: number;
}

export async function listSubagentRuns(
  sessionDir: string,
  parentSessionId: string,
  now = Date.now(),
  options: { parentActive?: boolean } = {},
): Promise<SessionSubagentRunInfo[]> {
  const runsDir = join(sessionDir, parentSessionId);
  const parentActive = options.parentActive === true;
  const artifactsDir = join(sessionDir, "subagent-artifacts");
  const directoryRunIds = await listDirectories(runsDir);
  const artifacts = await readArtifacts(artifactsDir);
  const running = await readRunningArtifacts(artifactsDir);
  // Both records of ownership, and nothing else: a directory under this parent,
  // or a spawn this parent wrote into its own transcript.
  const named = await runIdsNamedByParent(join(sessionDir, `${parentSessionId}.jsonl`));
  const owned = new Set(directoryRunIds);
  const runIds = [...directoryRunIds, ...[...named].filter((runId) => !owned.has(runId) && (running.has(runId) || artifacts.has(runId)))];
  if (runIds.length === 0) return [];
  const runs: SessionSubagentRunInfo[] = [];
  for (const runId of runIds) {
    const run = await describeRun(runsDir, runId, artifacts, running.get(runId), now, parentActive);
    if (run !== undefined) runs.push(run);
  }
  // Live work first, then most recent: the question this answers is usually
  // "who is still going", and a finished run is history.
  return runs.sort((a, b) => {
    if (a.status === "running" && b.status !== "running") return -1;
    if (b.status === "running" && a.status !== "running") return 1;
    return b.startedAt.localeCompare(a.startedAt);
  });
}

/**
 * A run directory is named after the child session, which is a uuid; the
 * neighbours that share the parent directory (`forks`, and `subagent-artifacts`
 * one level up) are named for what they hold. The name is the only thing that
 * separates a run that has not written yet from a neighbour that never will,
 * because on disk both are simply empty directories.
 */
const RUN_DIRECTORY_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * Whether a directory beside the parent session is one of its runs.
 *
 * An artifact or a `run-*` attempt settles it outright. Without either, the
 * name decides: a just-spawned child - and a fork-context child for its whole
 * life - has an empty directory, and refusing those hid every running fork
 * child from the list until it finished. `runStatus` still gets the last word
 * on what an empty directory means.
 */
async function looksLikeRun(runDir: string, runId: string, artifacts: Map<string, RunArtifact>): Promise<boolean> {
  if (artifacts.has(runId)) return true;
  const attempts = await listDirectories(runDir);
  if (attempts.some((name) => name.startsWith("run-"))) return true;
  return RUN_DIRECTORY_NAME.test(runId);
}

/**
 * Runs the artifacts directory shows as under way: those with a transcript but
 * no `meta.json`, which is the shape a child has from launch until it reports.
 * The agent name comes from the filename, so a run with no directory of its own
 * can still be named rather than falling back to the generic label.
 */
async function readRunningArtifacts(artifactsDir: string): Promise<Map<string, RunningArtifact>> {
  const running = new Map<string, RunningArtifact>();
  const names = await listNames(artifactsDir);
  const reported = new Set(names.filter((name) => name.endsWith("_meta.json")).map((name) => name.slice(0, name.indexOf("_"))));
  for (const name of names) {
    if (!name.endsWith("_transcript.jsonl")) continue;
    const runId = name.slice(0, name.indexOf("_"));
    if (runId === "" || reported.has(runId)) continue;
    const path = join(artifactsDir, name);
    const stats = await statOrUndefined(path);
    if (stats === undefined) continue;
    // Read for every unreported run, with no age filter: this only ever
    // describes a run the caller already owns by directory, so the mtime is a
    // liveness signal for `runStatus` and never a reason to list anything.
    const agent = agentFromArtifactName(name, runId);
    running.set(runId, { ...(agent === undefined ? {} : { agent }), transcriptPath: path, lastWriteMs: stats.mtimeMs });
  }
  return running;
}

/** `<runId>_<agent>_<n>_transcript.jsonl`, where the agent may itself contain underscores. */
function agentFromArtifactName(name: string, runId: string): string | undefined {
  const rest = name.slice(runId.length + 1).replace(/_transcript\.jsonl$/u, "");
  const agent = rest.replace(/_\d+$/u, "");
  return agent === "" ? undefined : agent;
}

/**
 * Why membership comes from the run directory and from nothing else.
 *
 * A subagent's result returns to the session that started it and to no other,
 * so which session a run belongs to is a fact fixed when it is spawned. The
 * only place that fact is written down is the run directory's location:
 * <sessionDir>/<parentSessionFile>/<runId>/, created under the parent that
 * started it.
 *
 * The artifacts directory records nothing about it. Read across all 53
 * transcripts and 50 `meta.json` files of one real project: `meta.json` carries
 * runId, agent, a `cwd` that is the whole project and a `transcriptPath`
 * pointing back into the artifacts directory, and the transcript records carry
 * runId, agent, childIndex, cwd - no session or parent field in any of them.
 * The directory is shared by every session in the project, so an artifact alone
 * cannot say whose run it is.
 *
 * A liveness window was tried here and was wrong by construction: it treated "a
 * transcript is being appended to right now" as "this belongs to whoever is
 * asking", so while any one session's child streamed, every session that listed
 * claimed it. The owner saw two sessions show a running ring at once and a
 * session with no children of its own report "1 background run". The evidence
 * that seemed to justify it - no foreign runs claimed - had been measured while
 * no foreign run was live, which is the one condition under which the bug
 * cannot appear.
 *
 * There is a second record, and it is what a fork-context child leaves: the
 * parent's own transcript. When its agent spawns a run, the `subagent` tool's
 * result is written into the parent's session file naming the run id
 * ("Async: worker [<runId>]"), so the parent has written down which runs are
 * its own. Measured across one project's eight session files, the 18 runs with
 * no directory of their own each appeared in exactly one parent, none in two -
 * and the run ids named by the two parents that spawn subagents did not
 * overlap. This is the same shape background tasks already use, where the
 * registry directory supplies state and the transcript supplies ownership.
 *
 * So a run neither of those records claims is not listed here. It is not hidden
 * work: it is another session's work, and it is listed there.
 */

/** How the subagent tool announces a spawn in its parent's transcript. */
const RUN_ID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu;

/**
 * Run ids this session's own agent started, read from the `subagent` tool
 * records in its transcript.
 *
 * Scoped to those records rather than matched against the whole file: a
 * transcript is also full of prose, and this session spent a day discussing run
 * ids belonging to other sessions. Only the tool's own call and result say "I
 * started this".
 */
async function runIdsNamedByParent(sessionFile: string): Promise<Set<string>> {
  const stats = await statOrUndefined(sessionFile);
  if (stats === undefined) return new Set();
  const cached = spawnedRunIdCache.get(sessionFile);
  // A transcript is only ever appended to, so everything already scanned stays
  // true and only the new tail can name a new run.
  if (cached !== undefined && cached.size <= stats.size && cached.mtimeMs === stats.mtimeMs) return cached.ids;
  const from = cached === undefined || cached.size > stats.size ? 0 : cached.size;
  const ids = cached === undefined || from === 0 ? new Set<string>() : cached.ids;
  const text = await readRange(sessionFile, from, stats.size);
  if (text !== undefined) {
    for (const line of text.split("\n")) collectSpawnedRunIds(line, ids);
  }
  spawnedRunIdCache.set(sessionFile, { size: stats.size, mtimeMs: stats.mtimeMs, ids });
  return ids;
}

/**
 * Spawn records already read from each parent transcript.
 *
 * Rescanning cost ~300ms of a 129MB read on every four-second poll, which is
 * the regression `readWindow` exists to prevent. Keyed by size and mtime so a
 * rewritten or truncated file is rescanned rather than trusted.
 */
const spawnedRunIdCache = new Map<string, { size: number; mtimeMs: number; ids: Set<string> }>();

/** The bytes appended since the last scan, so a growing transcript is read once. */
async function readRange(path: string, from: number, to: number): Promise<string | undefined> {
  if (to <= from) return "";
  let handle;
  try {
    handle = await open(path, "r");
    const buffer = Buffer.alloc(to - from);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, from);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** Adds the run ids a single transcript line records this session as spawning. */
function collectSpawnedRunIds(line: string, ids: Set<string>): void {
  // Cheap reject first: only a handful of lines in a long transcript mention
  // the tool at all, and JSON.parse on the rest is the whole cost.
  if (!line.includes("\"subagent\"")) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return;
  }
  if (!isRecord(parsed)) return;
  const message: unknown = parsed["message"];
  const content: unknown = isRecord(message) ? message["content"] : undefined;
  if (!Array.isArray(content)) return;
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (part["toolName"] !== "subagent" && part["name"] !== "subagent") continue;
    for (const id of JSON.stringify(part).matchAll(RUN_ID_PATTERN)) ids.add(id[0]);
  }
}

async function describeRun(runsDir: string, runId: string, artifacts: Map<string, RunArtifact>, running: RunningArtifact | undefined, now: number, parentActive: boolean): Promise<SessionSubagentRunInfo | undefined> {
  const runDir = join(runsDir, runId);
  // A live transcript is the run announcing itself; it needs no directory.
  if (running === undefined && !await looksLikeRun(runDir, runId, artifacts)) return undefined;
  const transcript = await findTranscript(runDir);
  // The run directory and the artifacts are named in two different id spaces:
  // the directory carries the child session's id, the artifacts the tool's own
  // run id. The child's transcript names itself after the tool run
  // ("subagent-<agent>-<runId>-<attempt>"), which is the only link between
  // them; without following it every finished run reported "unknown", showed
  // the generic agent name, and could not be opened because its output looked
  // absent.
  const identity = transcript === undefined ? undefined : await readRunIdentity(transcript);
  const artifact = artifacts.get(identity?.runId ?? runId) ?? artifacts.get(runId);
  const artifactRunId = identity?.runId !== undefined && artifacts.has(identity.runId) ? identity.runId : runId;
  let startedAt = artifact?.timestamp;
  let lastWriteMs: number | undefined;
  if (transcript !== undefined) {
    const stats = await statOrUndefined(transcript);
    if (stats !== undefined) {
      startedAt ??= stats.birthtime.toISOString();
      lastWriteMs = stats.mtimeMs;
    }
  }
  // A run with no directory of its own is only known through the artifacts it
  // writes as it goes, so they date it and say when it last moved.
  if (running !== undefined) {
    const stats = await statOrUndefined(running.transcriptPath);
    if (stats !== undefined) startedAt ??= stats.birthtime.toISOString();
    lastWriteMs ??= running.lastWriteMs;
  }
  if (startedAt === undefined) {
    // A run reached through its artifact alone has no directory to date it, but
    // an artifact without a timestamp is the only case left here: the row is
    // worth more than the precision, so it falls back to now.
    const dirStats = await statOrUndefined(runDir);
    if (dirStats === undefined && artifact === undefined) return undefined;
    startedAt = (dirStats?.birthtime ?? new Date(now)).toISOString();
  }
  const status = runStatus(artifact, lastWriteMs, Date.parse(startedAt), now, parentActive);
  const agent = artifact?.agent ?? identity?.agent ?? running?.agent ?? "subagent";
  // What the row says this run was: its own description when the tool kept one,
  // otherwise the first line of what it returned.
  const label = artifact?.task ?? artifact?.outputSummary;
  const elapsedMs = artifact?.durationMs ?? Math.max(0, (lastWriteMs ?? now) - Date.parse(startedAt));
  const lastActivity = status === "running" && transcript !== undefined ? await lastTranscriptStep(transcript) : undefined;
  return {
    runId: artifactRunId,
    agent,
    status,
    elapsedMs,
    startedAt,
    ...(lastActivity === undefined ? {} : { lastActivity }),
    ...(label === undefined ? {} : { task: label }),
    ...(artifact?.model === undefined ? {} : { model: artifact.model }),
    ...(artifact?.toolCount === undefined ? {} : { toolCount: artifact.toolCount }),
    hasOutput: artifact?.hasOutput === true,
  };
}

/**
 * Status comes from the artifact when there is one, because that is the run's
 * own verdict. Without it the only evidence is the transcript's mtime: a child
 * that has written recently is working, and one that stopped writing without
 * ever reporting was killed with its parent - saying "unknown" is honest, where
 * "running" would leave a ghost in the list forever.
 *
 * "There is an artifact" is not the same fact as "the run reported". A run
 * writes its prompt and opens its transcript at launch and only writes
 * `meta.json` when it ends, so treating any artifact as a verdict would mark a
 * child done the moment it started - worse than leaving it out, because the
 * row would claim work had finished while it was still being done.
 */
function runStatus(artifact: RunArtifact | undefined, lastWriteMs: number | undefined, startedAtMs: number, now: number, parentActive: boolean): SessionSubagentRunInfo["status"] {
  if (artifact?.exitCode !== undefined) return artifact.exitCode === 0 ? "done" : "failed";
  if (artifact?.reported === true) return "done";
  // A just-spawned child has written nothing yet, so only the parent can say -
  // and only while the child is young enough for that to be the explanation.
  // Past the grace period the silence is the answer: it died before writing,
  // which is what `lost` already means everywhere else in this module.
  if (lastWriteMs === undefined) {
    // Nobody is streaming to vouch for the child. While a launch could still
    // explain the silence the honest answer is nobody knows; past the grace
    // the silence is the answer, the same as an active parent's branch — a
    // run that wrote nothing and is too old for a launch died before writing.
    if (!parentActive) return silentSinceLaunch(startedAtMs, now) ? "lost" : "unknown";
    return silentSinceLaunch(startedAtMs, now) ? "lost" : "running";
  }
  const quietMs = now - lastWriteMs;
  if (quietMs < RUNNING_STALE_AFTER_MS) return "running";
  // An active parent widens the window rather than overriding it: treating it
  // as proof of life resurrected runs that had been dead for hours.
  if (parentActive && quietMs < PARENT_ACTIVE_STALE_AFTER_MS) return "running";
  return "lost";
}

/**
 * Whether a run has been silent for longer than a launch can account for. An
 * unreadable or future-dated start is not evidence of death, so it is not
 * treated as any: only a start we can place in the past can expire.
 */
function silentSinceLaunch(startedAtMs: number, now: number): boolean {
  return Number.isFinite(startedAtMs) && now - startedAtMs > SILENT_LAUNCH_GRACE_MS;
}

/** How the subagent tool names a child session: agent and originating run id. */
export function parseSubagentSessionName(name: string): { agent: string; runId: string } | undefined {
  const match = /^subagent-(?<agent>.+)-(?<runId>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-\d+)?$/u.exec(name);
  const agent = match?.groups?.["agent"];
  const runId = match?.groups?.["runId"];
  return agent === undefined || runId === undefined ? undefined : { agent, runId };
}

/**
 * The tool run a child transcript belongs to, read from its `session_info`
 * record. Only the head is read: the record is written before any model output.
 */
async function readRunIdentity(transcript: string): Promise<{ agent: string; runId: string } | undefined> {
  const head = await readWindow(transcript, HEAD_BYTES, "head");
  if (head === undefined) return undefined;
  for (const line of head.split("\n")) {
    if (!line.includes("\"session_info\"")) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const name = isRecordWithName(record) ? record.name : undefined;
    const identity = name === undefined ? undefined : parseSubagentSessionName(name);
    if (identity !== undefined) return identity;
  }
  return undefined;
}

function isRecordWithName(value: unknown): value is { name: string } {
  return isRecord(value) && typeof value["name"] === "string";
}

async function findTranscript(runDir: string): Promise<string | undefined> {
  // The tool numbers attempts run-0, run-1, ...; the highest is the live one.
  const attempts = (await listDirectories(runDir)).filter((name) => name.startsWith("run-")).sort();
  const latest = attempts.at(-1);
  if (latest === undefined) return undefined;
  const path = join(runDir, latest, "session.jsonl");
  return (await statOrUndefined(path)) === undefined ? undefined : path;
}

/**
 * The child's most recent step, in the words the child used: a tool name if it
 * is calling one, otherwise the start of what it is saying. Only the tail is
 * read - these transcripts reach megabytes and this runs on every poll.
 */
async function lastTranscriptStep(transcript: string): Promise<string | undefined> {
  const text = await readWindow(transcript, TAIL_BYTES, "tail");
  if (text === undefined) return undefined;
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  for (const line of lines.reverse()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // a truncated first line from slicing, or a partial write
    }
    const step = stepFromEntry(parsed);
    if (step !== undefined) return step;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stepFromEntry(entry: unknown): string | undefined {
  if (!isRecord(entry)) return undefined;
  // A transcript line wraps the model message: {"type":"message","message":
  // {"role":...,"content":[...]}}. Reading `content` off the line itself found
  // nothing in every real transcript, which is why a run that had not written
  // its result yet reported no steps at all - the row could not say what the
  // child was doing, and opening it answered "No output for this subagent
  // run". The flat shape is still accepted so a caller holding a message can
  // pass it directly.
  const message: unknown = entry["message"];
  const content: unknown = isRecord(message) ? message["content"] : entry["content"];
  if (!Array.isArray(content)) return undefined;
  // Walk backwards over the raw array: the last step is the interesting one,
  // and copying to reverse it would mean spreading values of unknown shape.
  for (let index = content.length - 1; index >= 0; index -= 1) {
    const part: unknown = content[index];
    if (!isRecord(part)) continue;
    const partRecord = part;
    const toolName = partRecord["toolName"];
    if (typeof toolName === "string" && toolName !== "") return toolName;
    const type = partRecord["type"];
    const text = partRecord["text"];
    if (type === "text" && typeof text === "string" && text.trim() !== "") return summarize(text);
  }
  return undefined;
}

function summarize(text: string): string {
  const firstLine = text.trim().split("\n")[0] ?? "";
  return firstLine.length > 120 ? `${firstLine.slice(0, 119)}…` : firstLine;
}

async function readArtifacts(artifactsDir: string): Promise<Map<string, RunArtifact>> {
  const artifacts = new Map<string, RunArtifact>();
  let names: string[];
  try {
    names = await readdir(artifactsDir);
  } catch {
    return artifacts;
  }
  const outputs = new Set(names.filter((name) => name.endsWith("_output.md")).map((name) => name.slice(0, name.indexOf("_"))));
  for (const name of names) {
    if (!name.endsWith("_meta.json")) continue;
    const runId = name.slice(0, name.indexOf("_"));
    if (runId === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(join(artifactsDir, name), "utf8"));
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    const record = parsed;
    const summaryFromOutput = outputs.has(runId) ? await firstLineOfOutput(artifactsDir, names, runId) : undefined;
    artifacts.set(runId, {
      ...(summaryFromOutput === undefined ? {} : { outputSummary: summaryFromOutput }),
      ...(typeof record["agent"] === "string" ? { agent: record["agent"] } : {}),
      // The tool redacts prompts, so `task` is the literal string
      // "[prompt redacted]" for every run - useless as a row label. The first
      // line of what the run returned says more about it than its own
      // description would have.
      ...(typeof record["task"] === "string" && !record["task"].includes("redacted") ? { task: summarize(record["task"]) } : {}),
      ...(typeof record["model"] === "string" ? { model: record["model"] } : {}),
      ...(typeof record["exitCode"] === "number" ? { exitCode: record["exitCode"] } : {}),
      ...(typeof record["durationMs"] === "number" ? { durationMs: record["durationMs"] } : {}),
      ...(typeof record["toolCount"] === "number" ? { toolCount: record["toolCount"] } : {}),
      ...(typeof record["timestamp"] === "string" ? { timestamp: record["timestamp"] } : {}),
      hasOutput: outputs.has(runId),
      // Reading a `meta.json` at all is the run's own report that it ended.
      reported: true,
    });
  }
  return artifacts;
}

/**
 * The result a finished run wrote. Read by run id rather than by path so a
 * caller cannot walk out of the artifacts directory with a crafted id, and
 * capped because a subagent's answer can be long enough to be worth truncating
 * rather than streaming into a chat line.
 */
export async function readSubagentRunOutput(
  sessionDir: string,
  runId: string,
  options: { parentSessionId?: string; maxChars?: number } = {},
): Promise<string | undefined> {
  const maxChars = options.maxChars ?? 20000;
  if (!isSafeRunId(runId)) return undefined;
  const artifactsDir = join(sessionDir, "subagent-artifacts");
  const names = await listNames(artifactsDir);
  const name = names.find((entry) => entry.startsWith(`${runId}_`) && entry.endsWith("_output.md"));
  if (name !== undefined) {
    try {
      const text = await readFile(join(artifactsDir, name), "utf8");
      return clamp(text, maxChars);
    } catch {
      return undefined;
    }
  }
  // No result file: the run is still going, or it ended without writing one.
  // Its transcript is the only account of what it did, and a row that opens
  // nothing is worse than a row that opens the work in progress.
  return options.parentSessionId === undefined
    ? undefined
    : await readRunProgress(join(sessionDir, options.parentSessionId), runId, maxChars);
}

/** Directory entries, or none when the directory does not exist yet. */
async function listNames(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

/** What a run has said so far, newest last, for a run with no result file. */
async function readRunProgress(runsDir: string, runId: string, maxChars: number): Promise<string | undefined> {
  const transcript = await findRunTranscript(runsDir, runId);
  if (transcript === undefined) return undefined;
  const text = await readWindow(transcript, TAIL_BYTES, "tail");
  if (text === undefined) return undefined;
  const steps: string[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // a truncated first line from slicing, or a partial write
    }
    const step = stepFromEntry(parsed);
    if (step !== undefined) steps.push(step);
  }
  if (steps.length === 0) return undefined;
  return clamp(`_This run has not written a result yet. Its latest steps:_\n\n${steps.slice(-40).map((step) => `- ${step}`).join("\n")}`, maxChars);
}

/** The transcript of a run, found by directory name or by the tool run it names. */
async function findRunTranscript(runsDir: string, runId: string): Promise<string | undefined> {
  const direct = await findTranscript(join(runsDir, runId));
  if (direct !== undefined) return direct;
  for (const candidate of await listDirectories(runsDir)) {
    const transcript = await findTranscript(join(runsDir, candidate));
    if (transcript === undefined) continue;
    const identity = await readRunIdentity(transcript);
    if (identity?.runId === runId) return transcript;
  }
  return undefined;
}

/**
 * Where a run's conversation is, whichever kind of child wrote it.
 *
 * A fresh-context child gets a run directory and writes an ordinary session
 * file inside it. A fork-context child - which is what the builtin `worker` and
 * `oracle` agents are - never creates that directory at all: its transcript is
 * the artifact it opens at launch and appends to as it works. Both are session
 * `jsonl` files of the same shape, so the only difference that matters here is
 * where to look.
 */
export async function findSubagentRunTranscript(
  sessionDir: string,
  runId: string,
  options: { parentSessionId?: string } = {},
): Promise<string | undefined> {
  if (!isSafeRunId(runId)) return undefined;
  if (options.parentSessionId !== undefined) {
    const owned = await findRunTranscript(join(sessionDir, options.parentSessionId), runId);
    if (owned !== undefined) return owned;
  }
  const artifactsDir = join(sessionDir, "subagent-artifacts");
  const names = await listNames(artifactsDir);
  const name = names.find((entry) => entry.startsWith(`${runId}_`) && entry.endsWith("_transcript.jsonl"));
  return name === undefined ? undefined : join(artifactsDir, name);
}

/** A run id is a path segment here, so it may not steer the read out of the directory. */
function isSafeRunId(runId: string): boolean {
  return runId !== "" && !runId.includes("/") && !runId.includes("\\") && !runId.includes("..");
}

/**
 * The entries of a session file, for a transcript Pi is not holding open.
 *
 * Read whole rather than windowed: the caller renders the conversation, and a
 * window would silently drop the beginning of it. A line that does not parse is
 * skipped - a transcript being appended to can end mid-write, and losing the
 * partial last line is better than failing the whole read.
 */
export async function readSessionEntries(path: string): Promise<unknown[] | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  const entries: unknown[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      continue;
    }
  }
  return entries;
}

function clamp(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n\n[truncated]` : text;
}

/** The first meaningful line of a finished run's result, as its row label. */
async function firstLineOfOutput(artifactsDir: string, names: string[], runId: string): Promise<string | undefined> {
  const name = names.find((entry) => entry.startsWith(`${runId}_`) && entry.endsWith("_output.md"));
  if (name === undefined) return undefined;
  const text = await readWindow(join(artifactsDir, name), OUTPUT_HEAD_BYTES, "head");
  if (text === undefined) return undefined;
  const line = text.split("\n").map((entry) => entry.replace(/^#+\s*/, "").trim()).find((entry) => entry !== "");
  return line === undefined ? undefined : summarize(line);
}

async function listDirectories(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function statOrUndefined(path: string) {
  try {
    return await stat(path);
  } catch {
    return undefined;
  }
}
