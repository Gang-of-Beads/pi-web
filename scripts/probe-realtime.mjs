#!/usr/bin/env node
/**
 * Live check of the state-sync redesign's browser-store phase on the 8505 stack.
 *
 *   1. A page reopened from its cache after a daemon restart shows what the new daemon did. The
 *      cached watermark belongs to the old daemon's seq space; the new daemon numbers from 1
 *      again. Cited without an epoch, the old seq read as a position in the new space: its
 *      frames after that seq replayed onto the cache and the ones before it - the prompt that
 *      started the run - never arrived.
 *   2. Frames lost on the wire are repaired: with the daemon dropping frames to the socket, the
 *      streamed reply on the live page equals the same reply read fresh by a new page.
 *   3. A message the daemon still queues stays one waiting row across a reconnect refresh. The
 *      old delta path rebuilt the transcript from the cache and dropped rows only this page
 *      held, leaving the replayed echo, a plain transcript row, in its place. The daemon's queue
 *      is read before and after, so a message handed over meanwhile makes the leg
 *      inconclusive instead of passing or failing it.
 *
 * Needs the stack started with PI_WEB_DEBUG_FRAME_DROP=1. The probe restarts the session
 * daemon twice through its tmux pane, and only ever a daemon whose working directory is this
 * repository, so the production daemon (8504, run from the Nix store) cannot be touched.
 */

import { execSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.PI_WEB_PROBE_BASE ?? "http://127.0.0.1:8505";
const PROJECT = process.env.PI_WEB_PROBE_PROJECT ?? "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = process.env.PI_WEB_PROBE_WORKSPACE ?? "ef2cdf93e1ac";
const SESSION = process.env.PI_WEB_PROBE_SESSION ?? "01a05000-5eed-7c00-8000-0000000000c1";
const CWD = process.env.PI_WEB_PROBE_CWD ?? "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";
const REPO = realpathSync(process.env.PI_WEB_PROBE_REPO ?? "/Users/hanxiao.du/Desktop/vincent/projects/pi-web");
const SESSIOND_TMUX = "pi-web-8505-sessiond";
const SESSIOND_SOCKET = process.env.PI_WEB_PROBE_SESSIOND_SOCKET ?? join(homedir(), ".pi-web-8505", "sessiond.sock");
if (REPO.startsWith("/nix/")) throw new Error("refusing to restart a daemon run from the Nix store");
const RUN = String(Date.now());
const PAGE_URL = `${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${SESSION}&view=chat`;

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`[${ok ? "ok" : "FAIL"}] ${name}: ${detail}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const query = `cwd=${encodeURIComponent(CWD)}`;

function daemonPid() {
  const pids = execSync("pgrep -f '^node dist/server/sessiond.js' || true", { encoding: "utf8" }).split("\n").filter((line) => line.trim() !== "");
  for (const pid of pids) {
    const cwd = execSync(`lsof -a -p ${pid} -d cwd -Fn 2>/dev/null | grep '^n' | cut -c2- || true`, { encoding: "utf8" }).trim();
    if (cwd === REPO) return pid;
  }
  return undefined;
}

/**
 * Arm the daemon's debug frame drop on its own socket. The web process does not forward
 * /api/debug and answers an unknown path with the app's HTML and a 200, so only the daemon's
 * JSON reply proves the drop is armed.
 */
function armFrameDrop(count) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ sessionId: SESSION, count });
    const call = httpRequest({ socketPath: SESSIOND_SOCKET, path: "/api/debug/frame-drop", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, (answer) => {
      let text = "";
      answer.on("data", (chunk) => { text += String(chunk); });
      answer.on("end", () => {
        if (text !== JSON.stringify({ armed: count })) reject(new Error(`precondition: the daemon did not arm the frame drop (${String(answer.statusCode)} ${text.slice(0, 80)}); start the stack with PI_WEB_DEBUG_FRAME_DROP=1`));
        else resolve();
      });
    });
    call.on("error", reject);
    call.end(body);
  });
}

async function daemonHealthy() {
  const answer = await fetch(`${BASE}/api/sessiond/health`).catch(() => undefined);
  return answer?.ok === true;
}

async function restartDaemon() {
  const before = daemonPid();
  if (before === undefined) throw new Error(`precondition: no 8505 session daemon running from ${REPO}`);
  execSync(`kill -TERM ${before}`);
  const exitDeadline = Date.now() + 30_000;
  while (execSync(`kill -0 ${before} 2>/dev/null && echo alive || true`, { encoding: "utf8" }).trim() === "alive") {
    if (Date.now() > exitDeadline) throw new Error(`precondition: daemon ${before} did not exit within 30 s`);
    await sleep(500);
  }
  execSync(`tmux respawn-pane -t ${SESSIOND_TMUX}`);
  const upDeadline = Date.now() + 60_000;
  for (;;) {
    const after = daemonPid();
    if (after !== undefined && after !== before && (await daemonHealthy())) return;
    if (Date.now() > upDeadline) throw new Error("precondition: the restarted daemon never answered health");
    await sleep(1000);
  }
}

async function status() {
  const answer = await fetch(`${BASE}/api/sessions/${SESSION}/status?${query}`);
  if (!answer.ok) throw new Error(`status ${String(answer.status)}`);
  return await answer.json();
}

async function waitIdle(timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const idle = await status().then((value) => value.isStreaming === false, () => false);
    if (idle) return true;
    await sleep(2000);
  }
  return false;
}

async function httpPrompt(text) {
  const answer = await fetch(`${BASE}/api/sessions/${SESSION}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: CWD, text, clientMessageId: `realtime-probe-${RUN}-${String(Math.random()).slice(2, 10)}` }),
  });
  if (!answer.ok) throw new Error(`precondition: prompt answered ${String(answer.status)}`);
}

async function streamSeq() {
  const answer = await fetch(`${BASE}/api/sessions/${SESSION}/stream-snapshot?${query}`);
  if (!answer.ok) throw new Error(`stream snapshot ${String(answer.status)}`);
  return (await answer.json()).seq;
}

async function openPage(context) {
  const page = await context.newPage();
  await page.goto(PAGE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);
  const selected = await page.evaluate(() => document.querySelector("pi-web-app")?.state?.selectedSession?.id ?? null);
  if (selected !== SESSION) throw new Error(`precondition: the app selected ${String(selected)}, not the probe session ${SESSION}; refusing to post into another session`);
  return page;
}

const rows = (page) => page.evaluate(() => (document.querySelector("pi-web-app")?.state?.messages ?? []).map((line) => ({
  role: line.role,
  text: (line.parts ?? []).filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text).join(""),
  state: line.meta?.delivery?.state ?? "transcript",
})));

const userRows = async (page, marker) => (await rows(page)).filter((row) => row.role === "user" && row.text.includes(marker));
const lastAssistantText = async (page) => (await rows(page)).filter((row) => row.role === "assistant" && row.text.trim() !== "").at(-1)?.text.trim() ?? "";

const cachedWatermark = (page) => page.evaluate((sessionId) => {
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index) ?? "";
    if (!key.startsWith("pi-web:chat-watermark:") || !key.includes(sessionId)) continue;
    const parsed = JSON.parse(localStorage.getItem(key) ?? "null");
    return typeof parsed === "number" ? { seq: parsed } : parsed;
  }
  return null;
}, SESSION);

const send = (page, text) => page.evaluate((body) => {
  const editor = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("prompt-editor");
  if (editor === null || editor === undefined) return "no composer";
  Reflect.set(editor, "draft", body);
  Reflect.apply(Reflect.get(editor, "send"), editor, [undefined]);
  return "ok";
}, text);

const browser = await chromium.launch();
try {
  await armFrameDrop(0);

  if (!(await waitIdle())) throw new Error("precondition: the probe session never went idle");
  await restartDaemon();
  await httpPrompt(`Reply with exactly: realtime-probe-${RUN}-A`);
  if (!(await waitIdle())) throw new Error("precondition: prompt A never finished");
  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, isMobile: true, hasTouch: true });
  const first = await openPage(context);
  const cached = await cachedWatermark(first);
  if (cached === null || typeof cached.seq !== "number" || cached.seq < 5) throw new Error(`precondition: the page cached no usable watermark (${JSON.stringify(cached)})`);
  await first.close();

  await restartDaemon();
  const markerB = `realtime-probe-${RUN}-B`;
  const witnessContext = await browser.newContext({ viewport: { width: 393, height: 850 }, isMobile: true, hasTouch: true });
  await openPage(witnessContext);
  await httpPrompt(`Count from 1 to 60, one number per line, then write ${markerB} on its own line.`);
  await sleep(3000);
  if (!(await waitIdle())) throw new Error("precondition: prompt B never finished");
  await witnessContext.close();
  const seqAfterRestart = await streamSeq();
  if (seqAfterRestart <= cached.seq) throw new Error(`precondition: the new daemon's seq ${String(seqAfterRestart)} never passed the cached watermark ${String(cached.seq)}; the leg would not discriminate`);
  const reopened = await openPage(context);
  const promptB = await userRows(reopened, markerB);
  const replyB = await lastAssistantText(reopened);
  record(
    "a page reopened after a daemon restart shows the new daemon's prompt and reply",
    promptB.length === 1 && replyB.includes(markerB),
    `cached watermark ${JSON.stringify(cached)}, new daemon at seq ${String(seqAfterRestart)}; prompt rows ${JSON.stringify(promptB.map((row) => row.state))}, reply ends ${JSON.stringify(replyB.slice(-40))}`,
  );

  const repairs = [];
  reopened.on("request", (request) => { if (request.url().includes("stream-snapshot") && request.url().includes("sinceSeq=")) repairs.push(request.url()); });
  const markerC = `realtime-probe-${RUN}-C`;
  await armFrameDrop(4);
  if ((await send(reopened, `Count from 1 to 40, one number per line, then write ${markerC} on its own line.`)) !== "ok") throw new Error("precondition: no composer");
  await sleep(3000);
  if (!(await waitIdle())) throw new Error("precondition: prompt C never finished");
  await reopened.waitForTimeout(4000);
  const liveC = await lastAssistantText(reopened);
  const freshContext = await browser.newContext({ viewport: { width: 393, height: 850 }, isMobile: true, hasTouch: true });
  const fresh = await openPage(freshContext);
  const freshC = await lastAssistantText(fresh);
  await freshContext.close();
  record(
    "frames dropped on the wire are repaired: the live reply equals the reply read fresh",
    repairs.length > 0 && liveC.includes(markerC) && liveC === freshC,
    `${String(repairs.length)} replay request(s); live ${String(liveC.length)} chars, fresh ${String(freshC.length)} chars, equal=${String(liveC === freshC)}`,
  );

  const markerD = `realtime-probe-${RUN}-D`;
  const markerE = `realtime-probe-${RUN}-E`;
  await send(reopened, `Count from 1 to 400, one number per line, then write ${markerD} on its own line.`);
  await sleep(2000);
  await send(reopened, `Reply with exactly: ${markerE}`);
  const waitingDeadline = Date.now() + 20_000;
  let waiting = await userRows(reopened, markerE);
  while (Date.now() < waitingDeadline && !(waiting.length === 1 && ["received", "queued"].includes(waiting[0].state))) {
    await reopened.waitForTimeout(500);
    waiting = await userRows(reopened, markerE);
  }
  if (!(waiting.length === 1 && ["received", "queued"].includes(waiting[0].state))) throw new Error(`precondition: message E never waited in the queue (${JSON.stringify(waiting)})`);
  const daemonQueuesE = async () => {
    const current = await status();
    return current.isStreaming === true && (current.queuedMessages ?? []).some((entry) => typeof entry.text === "string" && entry.text.includes(markerE));
  };
  if (!(await daemonQueuesE())) throw new Error("precondition: the daemon did not hold message E before the refresh; the leg would not hold a waiting row");
  const syncs = [];
  reopened.on("request", (request) => { if (request.url().includes("stream-snapshot") && request.url().includes("sinceSeq=")) syncs.push(request.url()); });
  await reopened.evaluate(() => Reflect.apply(Reflect.get(Reflect.get(document.querySelector("pi-web-app"), "sessions"), "refreshSelectedSession"), Reflect.get(document.querySelector("pi-web-app"), "sessions"), []));
  const afterRefresh = await userRows(reopened, markerE);
  if (!(await daemonQueuesE())) throw new Error(`precondition: the daemon handed message E over during the refresh (rows ${JSON.stringify(afterRefresh.map((row) => row.state))}); the leg cannot tell a kept row from a delivered one`);
  record(
    "a message the daemon still queues is one waiting row after a reconnect refresh",
    syncs.length > 0 && afterRefresh.length === 1 && ["received", "queued"].includes(afterRefresh[0].state),
    `${String(syncs.length)} delta request(s); the daemon still queues it; rows after the refresh ${JSON.stringify(afterRefresh.map((row) => row.state))}`,
  );
  await waitIdle();
  await context.close();
} finally {
  await browser.close();
}

const failed = results.filter((result) => !result.ok);
console.log(`RECORDS=${String(results.length)} FAILED=${String(failed.length)}`);
process.exit(failed.length === 0 && results.length === 3 ? 0 : 1);
