/**
 * Live check of the daemon inbox (state-sync redesign, phase 1) on the 8505 stack.
 *
 * Leg 1: while the agent runs a tool, three messages sent in order (no kind, steer, follow-up)
 * wait in the inbox in that order, and reach the transcript once each, in that order.
 * Leg 2: a message waiting when the daemon dies is handed after restart by the daemon itself -
 * the inbox file empties and the daemon logs the resume before this probe touches the session.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const SESSION = process.env.PI_WEB_PROBE_SESSION ?? "01a05000-5eed-7c00-8000-0000000000c1";
const CWD = process.env.PI_WEB_PROBE_CWD ?? "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";
const DATA_DIR = process.env.PI_WEB_8505_DATA_DIR ?? join(homedir(), ".pi-web-8505");
const INBOX_FILE = join(DATA_DIR, "inbox", `${SESSION}.json`);
const SESSIOND_LOG = join(DATA_DIR, "logs", "sessiond.log");
const MARK = `inbox-order-${String(Date.now())}`;
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`[${ok ? "ok" : "FAIL"}] ${name}: ${detail}`);
}

function finish() {
  const failures = results.filter((entry) => !entry.ok);
  console.log(failures.length === 0 ? "PROBE_PASS" : `PROBE_FAIL ${String(failures.length)}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function prompt(text, clientMessageId, streamingBehavior) {
  const answer = await fetch(`${BASE}/api/sessions/${SESSION}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: CWD, text, clientMessageId, ...(streamingBehavior === undefined ? {} : { streamingBehavior }) }),
  });
  return answer.status;
}

async function status() {
  const answer = await fetch(`${BASE}/api/sessions/${SESSION}/status?cwd=${encodeURIComponent(CWD)}`);
  if (!answer.ok) throw new Error(`status ${String(answer.status)}`);
  return await answer.json();
}

async function transcriptText() {
  const answer = await fetch(`${BASE}/api/sessions/${SESSION}/messages?cwd=${encodeURIComponent(CWD)}&limit=200`);
  if (!answer.ok) throw new Error(`messages ${String(answer.status)}`);
  return await answer.text();
}

async function until(name, check, timeoutMs, intervalMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check().catch(() => undefined);
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) {
      record(name, false, `timed out after ${String(timeoutMs)}ms`);
      return undefined;
    }
    await sleep(intervalMs);
  }
}

function occurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

async function startBusyRun(label) {
  const busy = await prompt("Run the bash tool with exactly: sleep 20. Then reply done.", `${MARK}-${label}`);
  record(`${label}: busy prompt accepted`, busy === 200, `status=${String(busy)}`);
  const running = await until(`${label}: agent is running a tool`, async () => (await status()).isStreaming === true, 30_000);
  if (running === undefined) finish();
  await sleep(3000);
}

await startBusyRun("busy-1");
const legOne = [
  { id: `${MARK}-a`, text: `Reply with exactly: ${MARK}-A`, kind: undefined },
  { id: `${MARK}-b`, text: `Reply with exactly: ${MARK}-B`, kind: "steer" },
  { id: `${MARK}-c`, text: `Reply with exactly: ${MARK}-C`, kind: "followUp" },
];
for (const message of legOne) {
  const code = await prompt(message.text, message.id, message.kind);
  record(`accepted ${message.id}`, code === 200, `status=${String(code)} kind=${String(message.kind)}`);
}
const waiting = await status();
const waitingIds = (waiting.queuedMessages ?? []).map((entry) => entry.clientMessageId).filter((id) => typeof id === "string" && id.startsWith(MARK));
record("held in acceptance order while the tool runs", JSON.stringify(waitingIds) === JSON.stringify(legOne.map((message) => message.id)), JSON.stringify(waitingIds));
record("inbox file holds them", existsSync(INBOX_FILE) && readFileSync(INBOX_FILE, "utf8").includes(`${MARK}-c`), INBOX_FILE);

const delivered = await until("all three reached the transcript", async () => {
  const text = await transcriptText();
  return legOne.every((message) => text.includes(message.text)) ? text : undefined;
}, 120_000, 3000);
if (delivered !== undefined) {
  const positions = legOne.map((message) => delivered.indexOf(message.text));
  record("transcript order is acceptance order", positions.every((position, index) => index === 0 || position > positions[index - 1]), JSON.stringify(positions));
  record("each delivered once", legOne.every((message) => occurrences(delivered, `"${message.text}"`) <= 1), legOne.map((message) => occurrences(delivered, `"${message.text}"`)).join(","));
}

await until("agent idle before leg 2", async () => (await status()).isStreaming === false, 120_000, 2000);
await startBusyRun("busy-2");
const parked = { id: `${MARK}-d`, text: `Reply with exactly: ${MARK}-D` };
const parkedCode = await prompt(parked.text, parked.id);
record("accepted while busy before the restart", parkedCode === 200, `status=${String(parkedCode)}`);
record("waiting in the inbox file", existsSync(INBOX_FILE) && readFileSync(INBOX_FILE, "utf8").includes(parked.id), INBOX_FILE);

const logOffset = existsSync(SESSIOND_LOG) ? statSync(SESSIOND_LOG).size : 0;
console.log("killing sessiond with a message waiting...");
execSync("tmux kill-session -t pi-web-8505-sessiond 2>/dev/null || true", { shell: "/bin/bash" });
await sleep(2000);
execSync("cd /Users/hanxiao.du/Desktop/vincent/projects/pi-web && bash scripts/stack-8505.sh up --skip-build", { stdio: "inherit" });

const resumedLine = await until("daemon resumed the waiting session on its own", async () => {
  const tail = readFileSync(SESSIOND_LOG, "utf8").slice(logOffset);
  return tail.split("\n").find((line) => line.includes("resumed sessions with waiting messages") && line.includes(SESSION));
}, 60_000);
if (resumedLine !== undefined) record("daemon resumed the waiting session on its own", true, resumedLine.slice(0, 160));
const emptied = await until("inbox handed without anyone opening the session", async () => !existsSync(INBOX_FILE) || !readFileSync(INBOX_FILE, "utf8").includes(parked.id), 60_000);
if (emptied !== undefined) record("inbox handed without anyone opening the session", true, INBOX_FILE);
const landed = await until("waiting message reached the transcript after restart", async () => (await transcriptText()).includes(parked.text), 120_000, 3000);
if (landed !== undefined) record("waiting message reached the transcript after restart", true, parked.id);

finish();
