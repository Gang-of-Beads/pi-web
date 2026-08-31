#!/usr/bin/env node
/**
 * Seed the 8505 test stack with subagent-run attribution fixtures.
 *
 * Recorded-fact attribution (src/server/daemon/sessions/subagentRuns.ts) says a run
 * belongs to a session only when one of two records says so: a run directory
 * under <sessionDir>/<parentSessionFile>/, or a `subagent` tool record in the
 * parent's own transcript. The shared `subagent-artifacts` directory records no
 * owner at all. These seeds put one run behind each record, plus the cases that
 * must NOT be claimed, so the live check can prove the rule rather than assume
 * it.
 *
 * What each seed exists to prove
 * -----------------------------
 * - session A and session B, same workspace: two parents that must not see each
 *   other's runs. Cross-appearance was the original defect.
 * - run A-done, directory-linked under A: attribution by run directory.
 * - run B-done, directory-linked under B: the same record for the other parent,
 *   so a passing check cannot come from "everything lands in A".
 * - run C-named, artifacts only, named by a `subagent` toolCall in A's
 *   transcript: attribution by the parent's own spawn/status record, with no
 *   directory of its own.
 * - run U-orphan, artifacts only and named by nobody: the unattributable case.
 *   It must appear in NEITHER list. This is the case a liveness window used to
 *   hand to whichever session asked.
 * - husk under A: an empty run directory, the shape a child leaves when it dies
 *   before writing anything. It reports `unknown`, not `lost`: `lost` for a run
 *   that never wrote needs parentActive === true (SILENT_LAUNCH_GRACE_MS in
 *   runStatus), which an idle seeded parent cannot have, and the run's age comes
 *   from directory birthtime, which APFS will not let a seeder backdate.
 * - lost run under A: a run directory whose `run-0/session.jsonl` was last
 *   written 45 minutes ago with no `_meta.json`. That is the real shape of a
 *   child killed with its parent, and it is what RUNNING_STALE_AFTER_MS (10
 *   minutes) reports as `lost` for an idle parent.
 * - long session: 400 messages, for scroll/paging checks that need a transcript
 *   too long to render in one go.
 *
 * Real shapes these mirror (read from this machine before writing)
 * ---------------------------------------------------------------
 * ~/.pi/agent/sessions/--Users-hanxiao.du-Desktop-vincent-projects-pi-web--/
 *   <ts>_<sessionId>.jsonl                    session header + model_change +
 *                                             thinking_level_change + messages
 *   <ts>_<sessionId>/<runId>/run-0/session.jsonl   child transcript, with the
 *                                             `session_info` record naming
 *                                             "subagent-<agent>-<runId>-1"
 *   <ts>_<sessionId>/<runId>/                 20 husks: empty directories
 *   subagent-artifacts/<runId>_<agent>_<n>_{input.md,transcript.jsonl,
 *                                            output.md,meta.json}
 * `meta.json` keeps `timestamp` as a NUMBER and `task` as "[prompt redacted]",
 * so seeds do too - that is why a run's start time comes from file times here.
 * The attributing transcript record is an assistant `toolCall` part
 * ({"type":"toolCall","name":"subagent","arguments":{"action":"status","id":
 * "<runId>"}}); the "Async: worker [<runId>]" toolResult line is written too
 * because it is what the tool really leaves behind, but it does not attribute:
 * its part carries no `toolName`/`name`, so collectSpawnedRunIds skips it.
 *
 * Where the seeds live, and the one place 8504 can see them
 * --------------------------------------------------------
 * The 8505 stack deliberately does not override the pi session store, so its
 * sessions come from the real store like the owner's do. The seeds therefore go
 * into the real store, but under their own workspace directory
 * (~/.pi-web-8505/pi-web-8505-seed-workspace), never into a real project's
 * session directory. The only place the owner's 8504 instance can see them is
 * the cross-project cleanup planner (piSessionService.ts:3240 `listAll`), which
 * enumerates every directory in the store root; nothing else on 8504 reads it.
 * `scripts/stack-8505.sh clean-seed` deletes exactly these two directories.
 *
 * Usage: node scripts/seed-8505-subagent-attribution.mjs [--clean]
 */
import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();
const DATA_DIR = process.env["PI_WEB_8505_DATA_DIR"] ?? join(HOME, ".pi-web-8505");
const SEED_WORKSPACE = join(DATA_DIR, "pi-web-8505-seed-workspace");
const STORE_ROOT = join(HOME, ".pi", "agent", "sessions");
/** The store names one directory per workspace; mirrors sessionDirInDefaultPiStore. */
const SESSION_DIR = join(STORE_ROOT, `--${SEED_WORKSPACE.replace(/^[/\\]/u, "").replace(/[/\\:]/gu, "-")}--`);
const ARTIFACTS_DIR = join(SESSION_DIR, "subagent-artifacts");
const MANIFEST_PATH = join(SEED_WORKSPACE, "seed-manifest.json");
/** Every path this script may delete must carry this, so a typo cannot reach real data. */
const SEED_MARKER = "pi-web-8505-seed";

const SESSION_A = { id: "01a05000-5eed-7a00-8000-0000000000a1", stem: "2026-08-28T09-00-00-000Z_01a05000-5eed-7a00-8000-0000000000a1" };
const SESSION_B = { id: "01a05000-5eed-7b00-8000-0000000000b1", stem: "2026-08-28T09-05-00-000Z_01a05000-5eed-7b00-8000-0000000000b1" };
const SESSION_LONG = { id: "01a05000-5eed-7c00-8000-0000000000c1", stem: "2026-08-28T09-10-00-000Z_01a05000-5eed-7c00-8000-0000000000c1" };
const RUN_A_DONE = "a11d0000-5eed-4a01-9000-000000000001";
const RUN_B_DONE = "b22d0000-5eed-4b01-9000-000000000002";
const RUN_C_NAMED = "c33c0000-5eed-4c01-9000-000000000003";
const RUN_U_ORPHAN = "d44f0000-5eed-4d01-9000-000000000004";
const RUN_H_HUSK = "e55b0000-5eed-4e01-9000-000000000005";
const RUN_L_LOST = "f66a0000-5eed-4f01-9000-000000000006";
const LONG_TRANSCRIPT_MESSAGES = 400;

const now = Date.now();
const minutesAgo = (minutes) => now - minutes * 60 * 1000;

if (process.argv.includes("--clean")) {
  await removeSeedDirectories();
  console.log(`removed ${SESSION_DIR}`);
  console.log(`removed ${SEED_WORKSPACE}`);
  process.exit(0);
}

await removeSeedDirectories();
await mkdir(SEED_WORKSPACE, { recursive: true });
await mkdir(ARTIFACTS_DIR, { recursive: true });
await writeFile(join(SEED_WORKSPACE, "README.md"), seedWorkspaceReadme(), "utf8");

await writeSessionA();
await writeSessionB();
await writeLongSession();

await writeDirectoryLinkedRun(SESSION_A.stem, RUN_A_DONE, "worker", 180);
await writeDirectoryLinkedRun(SESSION_B.stem, RUN_B_DONE, "worker", 175);
await writeArtifactsOnlyRun(RUN_C_NAMED, "worker", 120);
await writeArtifactsOnlyRun(RUN_U_ORPHAN, "scout", 100);
await writeHusk(SESSION_A.stem, RUN_H_HUSK);
await writeLostRun(SESSION_A.stem, RUN_L_LOST, "worker");

const manifest = {
  generatedAt: new Date(now).toISOString(),
  workspace: SEED_WORKSPACE,
  sessionDir: SESSION_DIR,
  sessions: {
    a: {
      id: SESSION_A.id,
      file: join(SESSION_DIR, `${SESSION_A.stem}.jsonl`),
      runs: [
        { runId: RUN_A_DONE, status: "done", attribution: "run-directory", proves: "a run directory under this parent is a record of ownership" },
        { runId: RUN_C_NAMED, status: "done", attribution: "parent-transcript", proves: "a subagent toolCall in the parent's transcript owns a run with no directory" },
        { runId: RUN_H_HUSK, status: "unknown", attribution: "run-directory", proves: "an empty run directory is listed, and reads unknown while the parent is idle" },
        { runId: RUN_L_LOST, status: "lost", attribution: "run-directory", proves: "a transcript quiet past RUNNING_STALE_AFTER_MS with no meta.json reads lost" },
      ],
    },
    b: {
      id: SESSION_B.id,
      file: join(SESSION_DIR, `${SESSION_B.stem}.jsonl`),
      runs: [
        { runId: RUN_B_DONE, status: "done", attribution: "run-directory", proves: "the other parent owns its own run and only its own" },
      ],
    },
    long: {
      id: SESSION_LONG.id,
      file: join(SESSION_DIR, `${SESSION_LONG.stem}.jsonl`),
      messageCount: LONG_TRANSCRIPT_MESSAGES,
      proves: "a transcript long enough for scroll and paging checks",
    },
  },
  unattributableRun: {
    runId: RUN_U_ORPHAN,
    proves: "artifacts record no owner, so a run no session claims belongs to neither",
  },
};
await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`seeded workspace : ${SEED_WORKSPACE}`);
console.log(`seeded store dir : ${SESSION_DIR}`);
console.log(`session A ${SESSION_A.id}  runs: ${manifest.sessions.a.runs.map((run) => `${run.runId.slice(0, 8)}=${run.status}`).join(" ")}`);
console.log(`session B ${SESSION_B.id}  runs: ${manifest.sessions.b.runs.map((run) => `${run.runId.slice(0, 8)}=${run.status}`).join(" ")}`);
console.log(`long session ${SESSION_LONG.id}  messages: ${String(LONG_TRANSCRIPT_MESSAGES)}`);
console.log(`unattributable run ${RUN_U_ORPHAN} (must appear in neither session)`);
console.log(`manifest         : ${MANIFEST_PATH}`);

async function removeSeedDirectories() {
  for (const path of [SESSION_DIR, SEED_WORKSPACE]) {
    // A delete inside the owner's real session store, so the marker is checked
    // rather than trusted: nothing without it is ever removed.
    if (!path.includes(SEED_MARKER)) throw new Error(`refusing to delete a path with no ${SEED_MARKER} marker: ${path}`);
    await rm(path, { recursive: true, force: true });
  }
}

function seedWorkspaceReadme() {
  return [
    "# PI WEB 8505 seed workspace",
    "",
    "Generated by `scripts/seed-8505-subagent-attribution.mjs`. Everything here and in",
    `\`${SESSION_DIR}\``,
    "is disposable test data for the 8505 stack; `scripts/stack-8505.sh clean-seed` removes both.",
    "",
  ].join("\n");
}

/** Session A: owns a directory-linked run, a transcript-named run, a husk and a lost run. */
async function writeSessionA() {
  const chain = entryChain(minutesAgo(190));
  const lines = [
    sessionHeader(SESSION_A.id, minutesAgo(190)),
    chain.next("model_change", { provider: "anthropic-work", modelId: "claude-opus-5" }),
    chain.next("thinking_level_change", { thinkingLevel: "max" }),
    chain.message(userMessage("Start a worker on the attribution fixtures and report back.")),
    chain.message(assistantToolCall("toolu_01seedA1SpawnWorkerRunA", { async: true, model: "anthropic-work/claude-opus-5:low", agent: "worker", task: "[prompt redacted]" })),
    chain.message(subagentAsyncResult("toolu_01seedA1SpawnWorkerRunA", "worker", RUN_A_DONE)),
    chain.message(assistantToolCall("toolu_01seedA2SpawnWorkerRunC", { async: true, model: "anthropic-work/claude-opus-5:low", agent: "worker", task: "[prompt redacted]" })),
    chain.message(subagentAsyncResult("toolu_01seedA2SpawnWorkerRunC", "worker", RUN_C_NAMED)),
    // The record that actually attributes run C: a `subagent` toolCall part
    // naming the run id. The async result above names it too, but its content
    // part carries no tool name, so the reader ignores it.
    chain.message(assistantToolCall("toolu_01seedA3StatusRunC", { action: "status", id: RUN_C_NAMED })),
    chain.message(toolResultText("toolu_01seedA3StatusRunC", "subagent", `worker [${RUN_C_NAMED}] finished with exit code 0`)),
    chain.message(assistantText("Both workers reported. Fixtures are in place.")),
  ];
  await writeSessionFile(SESSION_A.stem, lines);
}

/** Session B: the control. It owns exactly one run and names no other. */
async function writeSessionB() {
  const chain = entryChain(minutesAgo(185));
  const lines = [
    sessionHeader(SESSION_B.id, minutesAgo(185)),
    chain.next("model_change", { provider: "anthropic-work", modelId: "claude-opus-5" }),
    chain.next("thinking_level_change", { thinkingLevel: "medium" }),
    chain.message(userMessage("Run the second worker here, in the same workspace as the other session.")),
    chain.message(assistantToolCall("toolu_01seedB1SpawnWorkerRunB", { async: true, model: "anthropic-work/claude-opus-5:low", agent: "worker", task: "[prompt redacted]" })),
    chain.message(subagentAsyncResult("toolu_01seedB1SpawnWorkerRunB", "worker", RUN_B_DONE)),
    chain.message(assistantText("The worker is running in the background.")),
  ];
  await writeSessionFile(SESSION_B.stem, lines);
}

/** A transcript long enough that a client has to page or scroll it. */
async function writeLongSession() {
  const start = minutesAgo(400);
  const chain = entryChain(start);
  const lines = [
    sessionHeader(SESSION_LONG.id, start),
    chain.next("model_change", { provider: "anthropic-work", modelId: "claude-opus-5" }),
  ];
  for (let index = 0; index < LONG_TRANSCRIPT_MESSAGES; index += 1) {
    lines.push(index % 2 === 0
      ? chain.message(userMessage(`Long transcript turn ${String(index)}: keep going.`))
      : chain.message(assistantText(`Reply ${String(index)} of the long seeded transcript, kept short so the file stays readable.`)));
  }
  await writeSessionFile(SESSION_LONG.stem, lines);
}

async function writeSessionFile(stem, lines) {
  await writeFile(join(SESSION_DIR, `${stem}.jsonl`), `${lines.join("\n")}\n`, "utf8");
}

/** A finished run recorded by its directory under the parent, plus its artifacts. */
async function writeDirectoryLinkedRun(parentStem, runId, agent, startedMinutesAgo) {
  const runDir = join(SESSION_DIR, parentStem, runId, "run-0");
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "session.jsonl"), childTranscript(runId, agent, minutesAgo(startedMinutesAgo)), "utf8");
  await writeRunArtifacts(runId, agent, startedMinutesAgo);
}

/** A finished run with no directory: only the shared artifacts carry its name. */
async function writeArtifactsOnlyRun(runId, agent, startedMinutesAgo) {
  await writeRunArtifacts(runId, agent, startedMinutesAgo);
}

/** The husk: a run directory a child left empty because it died before writing. */
async function writeHusk(parentStem, runId) {
  await mkdir(join(SESSION_DIR, parentStem, runId), { recursive: true });
}

/** A child killed with its parent: a transcript that stopped, and no report. */
async function writeLostRun(parentStem, runId, agent) {
  const runDir = join(SESSION_DIR, parentStem, runId, "run-0");
  await mkdir(runDir, { recursive: true });
  const transcript = join(runDir, "session.jsonl");
  await writeFile(transcript, childTranscript(runId, agent, minutesAgo(60)), "utf8");
  // Quiet for 45 minutes: past RUNNING_STALE_AFTER_MS (10 minutes) and past the
  // 30-minute window an active parent would widen it to, so the status is
  // `lost` however the parent is behaving when the check runs.
  const quietSince = new Date(minutesAgo(45));
  await utimes(transcript, quietSince, quietSince);
  await utimes(runDir, quietSince, quietSince);
}

function childTranscript(runId, agent, startedMs) {
  const chain = entryChain(startedMs);
  const lines = [
    sessionHeader(`01a05000-5eed-7d00-8000-${runId.slice(-12)}`, startedMs),
    chain.next("session_info", { name: `subagent-${agent}-${runId}-1` }),
    chain.message(userMessage("[prompt redacted]; seeded child transcript.")),
    chain.message(assistantText("Read the fixtures and reported back.")),
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * The four files the tool leaves in the shared artifacts directory. `meta.json`
 * is written last in real life because it is the run's own report that it
 * ended, which is what makes the run read `done`.
 */
async function writeRunArtifacts(runId, agent, startedMinutesAgo) {
  const base = join(ARTIFACTS_DIR, `${runId}_${agent}_0`);
  const startedMs = minutesAgo(startedMinutesAgo);
  const finishedMs = minutesAgo(startedMinutesAgo - 4);
  await writeFile(`${base}_input.md`, `# Task for ${agent}\n\n[prompt redacted]; seeded run ${runId}.\n`, "utf8");
  await writeFile(`${base}_transcript.jsonl`, `${[
    JSON.stringify({ version: 1, recordType: "message", source: "foreground", runId, agent, childIndex: 0, cwd: SEED_WORKSPACE, ts: startedMs, timestamp: new Date(startedMs).toISOString(), sourceEventType: "initial_prompt", role: "user", text: "[prompt redacted]; seeded run.", message: { role: "user", content: [{ type: "text", text: "[prompt redacted]; seeded run." }] } }),
    JSON.stringify({ version: 1, recordType: "message", source: "foreground", runId, agent, childIndex: 0, cwd: SEED_WORKSPACE, ts: finishedMs, timestamp: new Date(finishedMs).toISOString(), sourceEventType: "message_end", role: "assistant", text: `Seeded ${agent} run ${runId} finished.`, message: { role: "assistant", content: [{ type: "text", text: `Seeded ${agent} run ${runId} finished.` }] } }),
  ].join("\n")}\n`, "utf8");
  await writeFile(`${base}_output.md`, `# Seeded ${agent} run\n\nRun ${runId}, written by scripts/seed-8505-subagent-attribution.mjs.\n`, "utf8");
  await writeFile(`${base}_meta.json`, `${JSON.stringify({
    runId,
    agent,
    task: "[prompt redacted]",
    exitCode: 0,
    usage: { input: 60, output: 4096, cacheRead: 120000, cacheWrite: 8000, cost: 0.42, turns: 6 },
    model: "anthropic-work/claude-opus-5:low",
    attemptedModels: ["anthropic-work/claude-opus-5:low"],
    durationMs: finishedMs - startedMs,
    toolCount: 7,
    transcriptPath: `${base}_transcript.jsonl`,
    // A number, exactly as the tool writes it. The reader only accepts a string
    // here, so a seeded run is dated from its files - same as a real one.
    timestamp: finishedMs,
  }, null, 2)}\n`, "utf8");
}

function sessionHeader(sessionId, atMs) {
  return JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: new Date(atMs).toISOString(), cwd: SEED_WORKSPACE });
}

/**
 * Session entries are a parent chain: every entry names the one before it. A
 * seeded transcript that broke the chain would not be the shape anything on
 * disk has.
 */
function entryChain(startMs) {
  let previousId = null;
  let index = 0;
  let atMs = startMs;
  const nextId = () => `5eed${String(index).padStart(4, "0")}`;
  return {
    next(type, fields) {
      const id = nextId();
      const entry = { type, id, parentId: previousId, timestamp: new Date(atMs).toISOString(), ...fields };
      previousId = id;
      index += 1;
      atMs += 1000;
      return JSON.stringify(entry);
    },
    message(message) {
      return this.next("message", { message });
    },
  };
}

function userMessage(text) {
  return { role: "user", content: [{ type: "text", text }], timestamp: now };
}

function assistantText(text) {
  return assistantMessage([{ type: "text", text }], "stop", "end_turn");
}

function assistantToolCall(callId, args) {
  return assistantMessage([{ type: "toolCall", id: callId, name: "subagent", arguments: args }], "toolUse", "tool_use");
}

function assistantMessage(content, stopReason, rawStopReason) {
  return {
    role: "assistant",
    content,
    api: "anthropic-messages",
    provider: "anthropic-work",
    model: "claude-opus-5",
    usage: { input: 2, output: 83, cacheRead: 165663, cacheWrite: 2526, totalTokens: 168274, cost: { input: 0.00001, output: 0.002075, cacheRead: 0.0828315, cacheWrite: 0.0157875, total: 0.100704 }, cacheWrite1h: 0, reasoning: 0 },
    stopReason,
    timestamp: now,
    responseId: "msg_seed8505attribution",
    rawStopReason,
  };
}

/** What the subagent tool writes back into the parent when a run is detached. */
function subagentAsyncResult(callId, agent, runId) {
  return toolResultText(callId, "subagent", `Run fan-out: 1/64 used, 63 remaining\nAsync: ${agent} [${runId}]\n\nThe async run is detached and running in the background.`);
}

function toolResultText(callId, toolName, text) {
  return { role: "toolResult", toolCallId: callId, toolName, content: [{ type: "text", text }], isError: false, timestamp: now };
}
