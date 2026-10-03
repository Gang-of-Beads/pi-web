import { chromium } from "@playwright/test";

/**
 * Scrolling keeps loading pages after a failed read and after a reopen (state-diagram D4; review
 * ca45d6ed row 11), 8505, phone 393x850. Reads the seed session (2,173 messages); no session is
 * created and nothing is prompted.
 *
 * Leg A, a failed newer read: scroll up until the newest end is dropped, fail the newer read, then
 * let reads succeed. Scrolling at the end must load the newer page, and the older end must still
 * load (on 040200ec the failed read stayed "in flight", which froze both ends).
 * Leg R, a reopen at a remembered spot: a fresh tab restores the reader where they left off; wheeling
 * up at the top of that window must load older history (on 040200ec the viewport stayed "restoring"
 * after the spot was restored, and a restoring viewport asks for nothing).
 * Leg B, a failing older read: a fresh tab with no remembered spot, every older read failing, the
 * reader resting at the top: count the reads in six quiet seconds. A failing read must not repeat at
 * network pace.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = "ef2cdf93e1ac";
const SESSION = "01a05000-5eed-7c00-8000-0000000000c1";
const URL = `${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${SESSION}&view=chat`;
const MESSAGES = /\/sessions\/[^/]+\/messages(?:\?|$)/u;
const QUIET_READ_LIMIT = 4;
const results = [];
const check = (name, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` (${detail})`}`);
};

const facts = (page) => page.evaluate(() => {
  const app = document.querySelector("pi-web-app");
  const state = app?.state;
  const view = app?.shadowRoot?.querySelector("chat-view");
  const chat = view?.shadowRoot?.querySelector(".chat");
  return {
    start: state?.messagePageStart ?? null,
    end: state?.messagePageEnd ?? null,
    total: state?.messagePageTotal ?? null,
    viewport: view?.viewportState?.kind ?? null,
    top: chat?.scrollTop ?? null,
    fromBottom: chat === null || chat === undefined ? null : chat.scrollHeight - chat.scrollTop - chat.clientHeight,
    box: chat === null || chat === undefined ? null : (() => { const rect = chat.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; })(),
  };
});

const failing503 = (route, what) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: `probe: ${what} unavailable` }) });

const wheelUntil = async (page, delta, pause, limit, done) => {
  let now = await facts(page);
  for (let step = 0; step < limit && !done(now); step += 1) {
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(pause);
    now = await facts(page);
  }
  return now;
};

const opened = async (page, label) => {
  await page.goto(URL);
  await page.waitForTimeout(9000);
  const now = await facts(page);
  check(`precondition: ${label}`, now.total !== null && now.total > 1000 && now.box !== null, JSON.stringify(now));
  await page.mouse.move(now.box.x, now.box.y);
  return now;
};

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 393, height: 850 } });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));

  const page = await context.newPage();
  const first = await opened(page, "leg A: the long session opens");
  const up = await wheelUntil(page, -4000, 400, 120, (now) => now.end !== now.total);
  check("precondition: scrolling up dropped the newest end from memory", up.end !== null && up.total !== null && up.end < up.total, JSON.stringify({ first: first.end, up }));
  let newerFailed = 0;
  let failing = true;
  await page.route(MESSAGES, async (route) => {
    if (route.request().url().includes("before=") || !failing) {
      await route.continue();
      return;
    }
    newerFailed += 1;
    await failing503(route, "newer page");
  });
  const atEnd = await wheelUntil(page, 600, 120, 300, (now) => newerFailed > 0 && now.fromBottom !== null && now.fromBottom <= 2);
  await page.waitForTimeout(1500);
  check("precondition: the newer read was asked for and failed", newerFailed > 0, JSON.stringify({ newerFailed, atEnd }));
  failing = false;
  let recovered = await facts(page);
  for (let step = 0; step < 40 && recovered.end === atEnd.end; step += 1) {
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(150);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(350);
    recovered = await facts(page);
  }
  check("once reads succeed, scrolling at the end loads the newer page", recovered.end !== null && atEnd.end !== null && recovered.end > atEnd.end, JSON.stringify({ failedAt: atEnd.end, now: recovered.end, total: recovered.total }));
  await page.unroute(MESSAGES);
  const startAfter = (await facts(page)).start;
  const olderAfter = await wheelUntil(page, -4000, 300, 60, (now) => now.start !== startAfter);
  check("after a failed newer read the older end still loads", olderAfter.start !== null && startAfter !== null && olderAfter.start < startAfter, JSON.stringify({ startAfter, now: olderAfter.start }));
  await page.close();

  const restored = await context.newPage();
  const reopened = await opened(restored, "leg R: a fresh tab reopens the session at the remembered spot");
  check("precondition: the reopen landed mid-transcript, not at the bottom", reopened.fromBottom !== null && reopened.fromBottom > 2000 && reopened.start !== null && reopened.start > 0, JSON.stringify(reopened));
  const startReopened = reopened.start;
  const olderReopened = await wheelUntil(restored, -4000, 300, 80, (now) => now.start !== startReopened);
  check("wheeling up from a restored spot loads older history", olderReopened.start !== null && startReopened !== null && olderReopened.start < startReopened, JSON.stringify({ startReopened, now: olderReopened.start, viewport: olderReopened.viewport }));
  await restored.close();

  const fresh = await context.newPage();
  await fresh.goto(URL);
  await fresh.evaluate(() => {
    for (const key of Object.keys(localStorage)) if (key.startsWith("pi-web:chat-scroll:")) localStorage.removeItem(key);
  });
  const atBottom = await opened(fresh, "leg B: a fresh tab with no remembered spot opens the session");
  check("precondition: it opens at the bottom, following", atBottom.fromBottom !== null && atBottom.fromBottom <= 2, JSON.stringify(atBottom));
  let olderReads = 0;
  await fresh.route(MESSAGES, async (route) => {
    if (!route.request().url().includes("before=")) {
      await route.continue();
      return;
    }
    olderReads += 1;
    await failing503(route, "older page");
  });
  const atTop = await wheelUntil(fresh, -4000, 300, 200, () => olderReads > 0);
  await fresh.waitForTimeout(1500);
  const asked = olderReads > 0;
  check("precondition: the older read was asked for and failed", asked, JSON.stringify({ olderReads, atTop }));
  const before = olderReads;
  await fresh.waitForTimeout(6000);
  const quietReads = olderReads - before;
  check(`a failing older read is not repeated at network pace while the reader rests (at most ${String(QUIET_READ_LIMIT)} reads in 6 s)`, asked && quietReads <= QUIET_READ_LIMIT, asked ? JSON.stringify({ quietReads, total: olderReads }) : "not measured: no older read was asked for");
  await fresh.unroute(MESSAGES);
  const startResting = (await facts(fresh)).start;
  const olderRecovered = await wheelUntil(fresh, -4000, 300, 60, (now) => now.start !== startResting);
  check("once reads succeed, wheeling up loads the older page", olderRecovered.start !== null && startResting !== null && olderRecovered.start < startResting, JSON.stringify({ startResting, now: olderRecovered.start }));
  await fresh.screenshot({ path: "/tmp/surfaces/failed-page-phone.png" });
  await context.close();
} finally {
  await browser.close();
}
const failed = results.filter((pass) => !pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
