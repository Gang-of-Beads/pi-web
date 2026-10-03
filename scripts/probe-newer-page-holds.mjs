import { chromium } from "@playwright/test";

/**
 * A newer page never moves a reader who is reading (state-diagram D4, B13), 8505, phone 393x850.
 *
 * The page keeps at most 400 transcript entries in memory; scrolling far enough up through a long
 * session drops the newest end, so the window ends before the newest message. Scrolling back down
 * into that end loads the newer page. That page snapped the reader to the bottom of everything
 * loaded and set them following, which is the jump the owner reported. The probe reads the seed
 * session (2,171 messages): it scrolls up until the newest end is dropped, scrolls down until a
 * newer page lands, and checks the reader is still reading where they were. A second pass slows
 * the newer page and waits at the very end of the older window before it lands: reaching that end
 * pinned the reader there, and the page landing under a pinned reader carried them down (review
 * ca45d6ed). No session is created and nothing is prompted.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = "ef2cdf93e1ac";
const SESSION = "01a05000-5eed-7c00-8000-0000000000c1";
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

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 393, height: 850 } });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${SESSION}&view=chat`);
  await page.waitForTimeout(9000);
  const opened = await facts(page);
  check("precondition: the long session opens with its newest end loaded", opened.total !== null && opened.total > 1000 && opened.end === opened.total && opened.box !== null, JSON.stringify(opened));
  await page.mouse.move(opened.box.x, opened.box.y);

  let up = opened;
  for (let step = 0; step < 120 && up.end === up.total; step += 1) {
    await page.mouse.wheel(0, -4000);
    await page.waitForTimeout(400);
    up = await facts(page);
  }
  check("precondition: scrolling up dropped the newest end from memory", up.end !== null && up.total !== null && up.end < up.total, JSON.stringify(up));

  let down = up;
  let before = up;
  for (let step = 0; step < 200 && down.end === up.end; step += 1) {
    before = down;
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(250);
    down = await facts(page);
  }
  await page.waitForTimeout(1500);
  const landed = await facts(page);
  check("precondition: scrolling down loaded the newer page", landed.end !== null && up.end !== null && landed.end > up.end, `${String(up.end)} -> ${String(landed.end)} of ${String(landed.total)}`);
  check("the reader is still reading after the newer page lands", landed.viewport === "holding" || landed.viewport === "awaitingPage", JSON.stringify({ before: before.viewport, after: landed.viewport }));
  check("and was not moved to the bottom of what loaded", landed.fromBottom !== null && landed.fromBottom > 400, JSON.stringify({ fromBottomBefore: before.fromBottom, fromBottomAfter: landed.fromBottom }));
  await page.screenshot({ path: "/tmp/surfaces/newer-page-holds-phone.png" });

  let again = await facts(page);
  for (let step = 0; step < 160 && again.end === again.total; step += 1) {
    await page.mouse.wheel(0, -4000);
    await page.waitForTimeout(400);
    again = await facts(page);
  }
  check("precondition: scrolling up again dropped the newest end", again.end !== null && again.total !== null && again.end < again.total, JSON.stringify(again));
  let requested = 0;
  await page.route(/\/sessions\/[^/]+\/messages(?:\?|$)/u, async (route) => {
    requested += 1;
    await new Promise((resolve) => { setTimeout(resolve, 4000); });
    await route.continue();
  });
  let atEnd = again;
  for (let step = 0; step < 300 && !(requested > 0 && atEnd.fromBottom !== null && atEnd.fromBottom <= 2); step += 1) {
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(120);
    atEnd = await facts(page);
  }
  check("precondition: the reader sits at the very end of the older window while the newer page is on its way", requested > 0 && atEnd.end === again.end && atEnd.fromBottom !== null && atEnd.fromBottom <= 2, JSON.stringify({ requested, atEnd }));
  let pinnedLanded = atEnd;
  for (let waited = 0; waited < 10_000 && pinnedLanded.end === again.end; waited += 250) {
    await page.waitForTimeout(250);
    pinnedLanded = await facts(page);
  }
  await page.waitForTimeout(1500);
  pinnedLanded = await facts(page);
  await page.unroute(/\/sessions\/[^/]+\/messages(?:\?|$)/u);
  check("precondition: the newer page landed", pinnedLanded.end !== null && again.end !== null && pinnedLanded.end > again.end, `${String(again.end)} -> ${String(pinnedLanded.end)}`);
  check("a reader waiting at the end of the older window is not carried down when it lands", pinnedLanded.fromBottom !== null && pinnedLanded.fromBottom > 400, JSON.stringify(pinnedLanded));
  await context.close();
} finally {
  await browser.close();
}
const failed = results.filter((pass) => !pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
