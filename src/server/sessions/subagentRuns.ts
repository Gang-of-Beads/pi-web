import { readdir, readFile, stat } from "node:fs/promises";
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
 * So the parent conversation could not say what its children were doing, or
 * even that it had any. Reading the directory is deliberate rather than
 * subscribing to the tool: the tool is an extension that may not be installed,
 * its runs outlive the turn that started them, and the files are what survives
 * a server restart.
 */

/** A run with no artifact and no recent write is treated as gone, not running. */
const RUNNING_STALE_AFTER_MS = 10 * 60 * 1000;
/** Enough of the tail to find the last step without reading a long transcript. */
const TAIL_BYTES = 64 * 1024;
/** The session header records sit in the first few lines of a transcript. */
const HEAD_BYTES = 8 * 1024;

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
}

export async function listSubagentRuns(sessionDir: string, parentSessionId: string, now = Date.now()): Promise<SessionSubagentRunInfo[]> {
  const runsDir = join(sessionDir, parentSessionId);
  const runIds = await listDirectories(runsDir);
  if (runIds.length === 0) return [];
  const artifacts = await readArtifacts(join(sessionDir, "subagent-artifacts"));
  const runs: SessionSubagentRunInfo[] = [];
  for (const runId of runIds) {
    const run = await describeRun(runsDir, runId, artifacts, now);
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

async function describeRun(runsDir: string, runId: string, artifacts: Map<string, RunArtifact>, now: number): Promise<SessionSubagentRunInfo | undefined> {
  const runDir = join(runsDir, runId);
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
  if (startedAt === undefined) {
    const dirStats = await statOrUndefined(runDir);
    if (dirStats === undefined) return undefined;
    startedAt = dirStats.birthtime.toISOString();
  }
  const status = runStatus(artifact, lastWriteMs, now);
  // What the row says this run was: its own description when the tool kept one,
  // otherwise the first line of what it returned.
  const label = artifact?.task ?? artifact?.outputSummary;
  const elapsedMs = artifact?.durationMs ?? Math.max(0, (lastWriteMs ?? now) - Date.parse(startedAt));
  const lastActivity = status === "running" && transcript !== undefined ? await lastTranscriptStep(transcript) : undefined;
  return {
    runId: artifactRunId,
    agent: artifact?.agent ?? identity?.agent ?? "subagent",
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
 */
function runStatus(artifact: RunArtifact | undefined, lastWriteMs: number | undefined, now: number): SessionSubagentRunInfo["status"] {
  if (artifact?.exitCode !== undefined) return artifact.exitCode === 0 ? "done" : "failed";
  if (artifact !== undefined) return "done";
  if (lastWriteMs === undefined) return "unknown";
  return now - lastWriteMs < RUNNING_STALE_AFTER_MS ? "running" : "unknown";
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
  let head: string;
  try {
    const text = await readFile(transcript, "utf8");
    head = text.slice(0, HEAD_BYTES);
  } catch {
    return undefined;
  }
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
  const stats = await statOrUndefined(transcript);
  if (stats === undefined) return undefined;
  let text: string;
  try {
    const handle = await readFile(transcript, "utf8");
    text = stats.size > TAIL_BYTES ? handle.slice(-TAIL_BYTES) : handle;
  } catch {
    return undefined;
  }
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
  if (runId === "" || runId.includes("/") || runId.includes("\\") || runId.includes("..")) return undefined;
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
  let text: string;
  try {
    const stats = await statOrUndefined(transcript);
    const contents = await readFile(transcript, "utf8");
    text = stats !== undefined && stats.size > TAIL_BYTES ? contents.slice(-TAIL_BYTES) : contents;
  } catch {
    return undefined;
  }
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

function clamp(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n\n[truncated]` : text;
}

/** The first meaningful line of a finished run's result, as its row label. */
async function firstLineOfOutput(artifactsDir: string, names: string[], runId: string): Promise<string | undefined> {
  const name = names.find((entry) => entry.startsWith(`${runId}_`) && entry.endsWith("_output.md"));
  if (name === undefined) return undefined;
  try {
    const text = await readFile(join(artifactsDir, name), "utf8");
    const line = text.split("\n").map((entry) => entry.replace(/^#+\s*/, "").trim()).find((entry) => entry !== "");
    return line === undefined ? undefined : summarize(line);
  } catch {
    return undefined;
  }
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
