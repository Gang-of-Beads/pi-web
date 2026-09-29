#!/usr/bin/env node
/**
 * Live check of the state-sync redesign's transport phase on the 8505 stack.
 *
 *   1. The web proxy answers for a daemon that does not: with the 8505 session daemon frozen
 *      (SIGSTOP), a session status read gets the proxy's 504 at its 25 s deadline, before the
 *      browser's 30 s.
 *   2. A send nobody answered for resolves on its own: sent from a phone-sized page while the
 *      daemon is frozen, the row turns unverifiable; once the daemon runs again the row leaves
 *      that state within the verification clock (5/15/45 s) - to received or later if the
 *      daemon took it, to failed if it never did - and never waits forever.
 *   3. A send the daemon never received - the request dropped by the network - has no server
 *      fact left to arrive: the verification clock alone ends its wait, calling it not received
 *      (failed, with Retry under the same identity) on the 45 s ask, never before.
 *   4. Two sends from one composer, pressed back to back, reach the transcript once each and in
 *      the order they were sent.
 *
 * Only a daemon whose working directory is this repository is ever frozen, so the production
 * daemon (8504, run from the Nix store) cannot be touched; the probe always resumes what it
 * froze.
 */

import { execSync } from "node:child_process";
import { chromium } from "playwright";

const BASE = process.env.PI_WEB_PROBE_BASE ?? "http://127.0.0.1:8505";
const PROJECT = process.env.PI_WEB_PROBE_PROJECT ?? "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = process.env.PI_WEB_PROBE_WORKSPACE ?? "ef2cdf93e1ac";
const SESSION = process.env.PI_WEB_PROBE_SESSION ?? "01a05000-5eed-7c00-8000-0000000000c1";
const CWD = process.env.PI_WEB_PROBE_CWD ?? "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";
const REPO = process.env.PI_WEB_PROBE_REPO ?? "/Users/hanxiao.du/Desktop/vincent/projects/pi-web";
if (REPO.startsWith("/nix/")) throw new Error("refusing to freeze a daemon run from the Nix store");
const RUN = String(Date.now());

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`[${ok ? "ok" : "FAIL"}] ${name}: ${detail}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function daemonPid() {
  const pids = execSync("pgrep -f '^node dist/server/sessiond.js' || true", { encoding: "utf8" }).split("\n").filter((line) => line.trim() !== "");
  for (const pid of pids) {
    const cwd = execSync(`lsof -a -p ${pid} -d cwd -Fn 2>/dev/null | grep '^n' | cut -c2- || true`, { encoding: "utf8" }).trim();
    if (cwd === REPO) return pid;
  }
  throw new Error(`precondition: no 8505 session daemon running from ${REPO}`);
}

let frozen;
function freeze() {
  frozen = daemonPid();
  execSync(`kill -STOP ${frozen}`);
}
function thaw() {
  if (frozen === undefined) return;
  execSync(`kill -CONT ${frozen}`);
  frozen = undefined;
}

async function waitIdle() {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const answer = await fetch(`${BASE}/api/sessions/${SESSION}/status?cwd=${encodeURIComponent(CWD)}`).catch(() => undefined);
    if (answer?.ok === true && (await answer.json()).isStreaming === false) return true;
    await sleep(2000);
  }
  return false;
}

const browser = await chromium.launch();
try {
  if (!(await waitIdle())) throw new Error("precondition: the probe session never went idle");

  freeze();
  const started = Date.now();
  const frozenRead = await fetch(`${BASE}/api/sessions/${SESSION}/status?cwd=${encodeURIComponent(CWD)}`, { signal: AbortSignal.timeout(40_000) })
    .then((answer) => answer.status, (error) => `no answer (${String(error)})`);
  const elapsed = Date.now() - started;
  thaw();
  record("the proxy answers a frozen daemon's read itself, before the browser's 30 s", frozenRead === 504 && elapsed >= 24_000 && elapsed < 30_000, `status=${String(frozenRead)} after ${String(elapsed)} ms`);

  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${SESSION}&view=chat`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);
  const selected = await page.evaluate(() => document.querySelector("pi-web-app")?.state?.selectedSession?.id ?? null);
  if (selected !== SESSION) throw new Error(`precondition: the app selected ${String(selected)}, not the probe session ${SESSION}; refusing to post into another session`);

  const send = (texts) => page.evaluate((all) => {
    const editor = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("prompt-editor");
    if (editor === null || editor === undefined) return "no composer";
    for (const text of all) {
      Reflect.set(editor, "draft", text);
      Reflect.apply(Reflect.get(editor, "send"), editor, [undefined]);
    }
    return "ok";
  }, texts);
  const rowStates = (marker) => page.evaluate((wanted) => {
    const lines = document.querySelector("pi-web-app")?.state?.messages ?? [];
    return lines
      .filter((line) => line.role === "user" && (line.parts ?? []).some((part) => part.type === "text" && part.text.includes(wanted)))
      .map((line) => line.meta?.delivery?.state ?? "transcript");
  }, marker);

  const unanswered = `Reply with exactly: transport-probe-${RUN}-V`;
  freeze();
  if ((await send([unanswered])) !== "ok") throw new Error("precondition: no composer");
  await page.waitForTimeout(28_000);
  const whileFrozen = await rowStates(unanswered);
  thaw();
  record("a send the daemon did not answer is shown unverifiable, once", JSON.stringify(whileFrozen) === JSON.stringify(["unverifiable"]), JSON.stringify(whileFrozen));
  const resolvedAt = Date.now();
  let resolved = whileFrozen;
  while (Date.now() - resolvedAt < 60_000) {
    resolved = await rowStates(unanswered);
    if (resolved.length === 1 && resolved[0] !== "unverifiable") break;
    await page.waitForTimeout(1000);
  }
  record("the unverifiable row resolves on its own after the daemon runs again", resolved.length === 1 && resolved[0] !== "unverifiable", `${JSON.stringify(resolved)} after ${String(Date.now() - resolvedAt)} ms`);

  if (!(await waitIdle())) throw new Error("precondition: the session never went idle after the unverifiable leg");
  const lost = `Reply with exactly: transport-probe-${RUN}-L`;
  await page.route("**/prompt*", (route) => route.abort("connectionreset"));
  await send([lost]);
  await page.waitForTimeout(2000);
  const lostAtOnce = await rowStates(lost);
  await page.unroute("**/prompt*");
  await page.waitForTimeout(18_000);
  const lostEarly = await rowStates(lost);
  const lostDeadline = Date.now() + 40_000;
  let lostLate = lostEarly;
  while (Date.now() < lostDeadline) {
    lostLate = await rowStates(lost);
    if (lostLate[0] !== "unverifiable") break;
    await page.waitForTimeout(1000);
  }
  record(
    "a send the daemon never received waits through the early asks, then is called not received",
    JSON.stringify(lostAtOnce) === JSON.stringify(["unverifiable"]) && JSON.stringify(lostEarly) === JSON.stringify(["unverifiable"]) && JSON.stringify(lostLate) === JSON.stringify(["failed"]),
    `at once ${JSON.stringify(lostAtOnce)}, at 20 s ${JSON.stringify(lostEarly)}, by 60 s ${JSON.stringify(lostLate)}`,
  );
  await page.waitForTimeout(3000);
  const first = `Reply with exactly: transport-probe-${RUN}-F1`;
  const second = `Reply with exactly: transport-probe-${RUN}-F2`;
  await send([first, second]);
  const orderedBy = Date.now() + 180_000;
  let transcript = "";
  while (Date.now() < orderedBy) {
    const answer = await fetch(`${BASE}/api/sessions/${SESSION}/messages?cwd=${encodeURIComponent(CWD)}&limit=200`);
    transcript = answer.ok ? await answer.text() : "";
    if (transcript.includes(first) && transcript.includes(second)) break;
    await sleep(3000);
  }
  const count = (needle) => transcript.split(`"${needle}"`).length - 1;
  record(
    "two back-to-back sends reach the transcript once each, in the order they were sent",
    count(first) === 1 && count(second) === 1 && transcript.indexOf(first) < transcript.indexOf(second),
    `counts=${String(count(first))},${String(count(second))} positions=${String(transcript.indexOf(first))},${String(transcript.indexOf(second))}`,
  );
  await page.screenshot({ path: "/tmp/probe-transport.png" });
} catch (error) {
  record("probe ran", false, String(error));
} finally {
  thaw();
  await browser.close();
}
const failures = results.filter((entry) => !entry.ok).length;
console.log(failures === 0 ? "PROBE_PASS" : `PROBE_FAIL ${String(failures)}`);
process.exit(failures === 0 ? 0 : 1);
