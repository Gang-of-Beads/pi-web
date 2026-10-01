import { chromium } from "@playwright/test";

/**
 * Pins are live from an event, not re-read on every render (state-diagram D5; P5 slice a), 8505.
 *
 * - Idle: the git panel open for 60 s with nothing happening reads the session pins 0 times (it
 *   read them 7-8 times a minute: every render more than 2 s after the last read re-read them).
 * - Live: two browsers on the same machine. A pin made through the machine's pin route (as another
 *   device's tap does) shows in the other browser within 3 s, without a reload, through one read.
 */
const BASE = "http://127.0.0.1:8505";
const PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = "ef2cdf93e1ac";
const SESSION = "01a05000-5eed-7c00-8000-0000000000e1";
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` (${detail})`}`);
};
const setPin = (pinned) => fetch(`${BASE}/api/machines/local/session-pins`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: SESSION, pinned }) });

const browser = await chromium.launch();
try {
  await setPin(false);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  const pinReads = [];
  page.on("request", (request) => { if (request.url().includes("/session-pins")) pinReads.push(Date.now()); });
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${SESSION}&tool=${encodeURIComponent("git:workspace.git")}&view=${encodeURIComponent("git:workspace.git")}`);
  await page.waitForTimeout(10_000);
  const pinnedNow = () => page.evaluate((id) => document.querySelector("pi-web-app")?.pinnedSessionIds?.has(id) === true, SESSION);
  check("precondition: the page read the pins, and the session is not pinned", pinReads.length >= 1 && !(await pinnedNow()), `reads ${String(pinReads.length)}`);

  const idleFrom = Date.now();
  await page.waitForTimeout(60_000);
  const idleReads = pinReads.filter((at) => at >= idleFrom).length;
  check("idle with the git panel open, the page reads the pins 0 times in 60 s", idleReads === 0, `reads ${String(idleReads)}`);

  const pinnedFrom = Date.now();
  const answer = await setPin(true);
  let shownAfter;
  for (let waited = 0; waited <= 3000; waited += 100) {
    if (await pinnedNow()) { shownAfter = Date.now() - pinnedFrom; break; }
    await page.waitForTimeout(100);
  }
  check("precondition: the machine took the pin", answer.status === 200, `status ${String(answer.status)}`);
  check("a pin made elsewhere shows within 3 s without a reload", shownAfter !== undefined, `after ${String(shownAfter)} ms`);
  check("it took one read of the pins", pinReads.filter((at) => at >= pinnedFrom).length === 1, `reads ${String(pinReads.filter((at) => at >= pinnedFrom).length)}`);
} finally {
  await setPin(false);
  await browser.close();
}
const failed = results.filter((result) => !result.pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
