import { execSync } from "node:child_process";

const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const SESSION = "01a06835-8d26-7f50-ae73-a22d3b9fc00c";
const CWD = "/private/tmp/test";
const MARK = `queue-restart-${String(Date.now())}`;
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`[${ok ? "ok" : "FAIL"}] ${name}: ${detail}`);
}

async function post(path, body) {
  const answer = await fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return answer.status;
}

async function status() {
  const answer = await fetch(`${BASE}/api/sessions/${SESSION}/status?cwd=${encodeURIComponent(CWD)}`);
  if (!answer.ok) return undefined;
  return await answer.json();
}

async function waitFor(name, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snapshot = await status().catch(() => undefined);
    if (snapshot !== undefined && predicate(snapshot)) return snapshot;
    if (Date.now() > deadline) {
      record(name, false, `timed out after ${String(timeoutMs)}ms`);
      return undefined;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

async function transcriptHasMark() {
  const answer = await fetch(`${BASE}/api/sessions/${SESSION}/messages?cwd=${encodeURIComponent(CWD)}`);
  if (!answer.ok) return false;
  const body = await answer.text();
  return body.includes(MARK);
}

const busyStatus = await post(`/api/sessions/${SESSION}/prompt`, { cwd: CWD, text: "Run the bash tool with exactly: sleep 20. Then reply done.", clientMessageId: `${MARK}-busy` });
record("busy prompt accepted", busyStatus === 200, `status=${String(busyStatus)}`);
await new Promise((resolve) => setTimeout(resolve, 4000));

const parkStatus = await post(`/api/sessions/${SESSION}/prompt`, { cwd: CWD, text: `Reply with exactly: ${MARK}`, clientMessageId: `${MARK}-parked` });
record("follow-up accepted while busy", parkStatus === 200, `status=${String(parkStatus)}`);

const queuedSnapshot = await waitFor("parked message listed in status", (snapshot) => (snapshot.queuedMessages ?? []).some((entry) => entry.clientMessageId === `${MARK}-parked`), 10_000);
record("parked message listed in status", queuedSnapshot !== undefined, JSON.stringify(queuedSnapshot?.queuedMessages ?? []));

console.log("killing sessiond mid-queue...");
execSync("tmux kill-session -t pi-web-8505-sessiond 2>/dev/null || true", { shell: "/bin/bash" });
await new Promise((resolve) => setTimeout(resolve, 2000));
execSync("cd /Users/hanxiao.du/Desktop/vincent/projects/pi-web && bash scripts/stack-8505.sh up --skip-build", { stdio: "inherit" });
await new Promise((resolve) => setTimeout(resolve, 5000));

const reopened = await waitFor("session reachable after restart", (snapshot) => typeof snapshot.sessionId === "string", 30_000);
record("session reachable after restart", reopened !== undefined, `sessionId=${String(reopened?.sessionId)}`);

const drained = await (async () => {
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (await transcriptHasMark()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
})();
record("parked message survived restart and drained", drained === true, `mark=${MARK}`);

const failures = results.filter((entry) => !entry.ok);
console.log(failures.length === 0 ? "PROBE_PASS" : `PROBE_FAIL ${String(failures.length)}`);
process.exit(failures.length === 0 ? 0 : 1);
