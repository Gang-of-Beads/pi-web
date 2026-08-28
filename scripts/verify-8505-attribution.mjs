#!/usr/bin/env node
/**
 * Live check of subagent-run attribution against the running 8505 stack.
 *
 * Commit 92c0aa02 replaced inference with recorded fact: a run belongs to the
 * session whose directory holds it, or whose transcript names it, and to no
 * other. The unit tests prove the reader; this proves the whole stack - HTTP
 * route, session resolution, daemon and disk - against the fixtures written by
 * scripts/seed-8505-subagent-attribution.mjs.
 *
 * It refuses empty passes: a missing seed, a stack that is not up, a session
 * that lists no runs at all, or a run that appears in the wrong session is a
 * FAIL, never a quiet success.
 *
 * Usage: node scripts/verify-8505-attribution.mjs [base-url]
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const base = process.argv[2] ?? "http://127.0.0.1:8505";
const dataDir = process.env["PI_WEB_8505_DATA_DIR"] ?? join(homedir(), ".pi-web-8505");
const manifestPath = join(dataDir, "pi-web-8505-seed-workspace", "seed-manifest.json");

let failed = false;
const check = (ok, label, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : `  ${detail}`}`);
  if (!ok) failed = true;
};
const fatal = (message) => {
  console.error(`FAIL  ${message}`);
  process.exit(1);
};

const status = async (path) => {
  try {
    const response = await fetch(`${base}${path}`);
    return response.status;
  } catch (error) {
    return `unreachable (${String(error)})`;
  }
};

const getJson = async (path) => {
  const response = await fetch(`${base}${path}`);
  if (!response.ok) fatal(`GET ${path} answered ${String(response.status)}`);
  return response.json();
};

const appStatus = await status("/");
const daemonStatus = await status("/api/sessiond/health");
if (appStatus !== 200 || daemonStatus !== 200) {
  fatal(`the 8505 stack is not up (app=${String(appStatus)} daemon=${String(daemonStatus)}); run scripts/stack-8505.sh up`);
}
console.log(`stack     ${base} app=200 daemon=200`);

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch {
  fatal(`no seed manifest at ${manifestPath}; run scripts/stack-8505.sh seed`);
}

const workspace = manifest.workspace;
const sessionQuery = new URLSearchParams({ cwd: workspace }).toString();
const expected = {
  a: manifest.sessions.a,
  b: manifest.sessions.b,
};
const orphanRunId = manifest.unattributableRun.runId;
console.log(`workspace ${workspace}`);

// Precondition: the seeded sessions must actually be listed. An unseeded stack
// would otherwise "pass" every cross-appearance assertion by listing nothing.
const listed = await getJson(`/api/sessions?${sessionQuery}`);
const listedIds = new Set(listed.map((session) => session.id));
const seededSessionIds = [expected.a.id, expected.b.id, manifest.sessions.long.id];
const missing = seededSessionIds.filter((id) => !listedIds.has(id));
check(listed.length > 0, "the workspace lists sessions at all", `count=${String(listed.length)}`);
check(missing.length === 0, "all three seeded sessions are listed", missing.length === 0 ? `A, B, long` : `missing ${missing.join(", ")}`);
if (failed) process.exit(1);

const runsOf = async (sessionId) => {
  const payload = await getJson(`/api/sessions/${encodeURIComponent(sessionId)}/subsessions?${sessionQuery}`);
  return payload.toolRuns ?? [];
};

const runsA = await runsOf(expected.a.id);
const runsB = await runsOf(expected.b.id);
const idsA = runsA.map((run) => run.runId);
const idsB = runsB.map((run) => run.runId);

console.log(`session A ${expected.a.id}  runs=${String(runsA.length)}  ${runsA.map((run) => `${run.runId.slice(0, 8)}:${run.status}`).join(" ") || "(none)"}`);
console.log(`session B ${expected.b.id}  runs=${String(runsB.length)}  ${runsB.map((run) => `${run.runId.slice(0, 8)}:${run.status}`).join(" ") || "(none)"}`);

const sameSet = (actual, wanted) => actual.length === wanted.length && wanted.every((id) => actual.includes(id));

for (const [label, session, actualIds, actualRuns] of [["A", expected.a, idsA, runsA], ["B", expected.b, idsB, runsB]]) {
  const wantedIds = session.runs.map((run) => run.runId);
  check(actualRuns.length > 0, `session ${label} lists its runs`, `count=${String(actualRuns.length)}`);
  check(sameSet(actualIds, wantedIds), `session ${label} lists exactly its own runs`, `expected ${String(wantedIds.length)}, got ${actualIds.join(",") || "(none)"}`);
  for (const wanted of session.runs) {
    const run = actualRuns.find((candidate) => candidate.runId === wanted.runId);
    check(run !== undefined, `session ${label} contains ${wanted.runId.slice(0, 8)} (${wanted.attribution})`, wanted.proves);
    if (run !== undefined) {
      check(run.status === wanted.status, `${wanted.runId.slice(0, 8)} status is ${wanted.status}`, `got ${run.status}`);
    }
  }
}

// The defect this check exists for: one session claiming another's run.
const foreignInA = expected.b.runs.filter((run) => idsA.includes(run.runId)).map((run) => run.runId);
const foreignInB = expected.a.runs.filter((run) => idsB.includes(run.runId)).map((run) => run.runId);
check(foreignInA.length === 0, "session A does not contain B's run", foreignInA.join(",") || "no cross-appearance");
check(foreignInB.length === 0, "session B does not contain A's runs", foreignInB.join(",") || "no cross-appearance");

// Artifacts record no owner, so a run neither record claims belongs to neither.
check(!idsA.includes(orphanRunId), "the unattributable run is absent from session A", orphanRunId);
check(!idsB.includes(orphanRunId), "the unattributable run is absent from session B", orphanRunId);

if (failed) {
  console.error("attribution live check FAILED");
  process.exit(1);
}
console.log(`counts: A=${String(runsA.length)} B=${String(runsB.length)} unattributable=0`);
console.log("attribution live check PASSED");
