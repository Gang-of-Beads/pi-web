import { chromium } from "@playwright/test";

/**
 * The Sessions board is a place: a reload stays there (B41, state-diagram D8, product audit
 * 5d672be6 navigation P2-1), 8505, phone 393x850.
 *
 * The audit reached the board from an open session ("Sessions" in Go to), left the session in the
 * URL with no view, and a reload dropped the reader into that chat. Since D8 the phone shows the
 * board only when no session is selected (the way back forgets the target, and ≡ opens the Go to
 * page over a chat), so the board's URL names no session. This probe guards that: a workspace link
 * with no session opens the board and a reload keeps it; a session opened from the board and left
 * with Back returns to the board, and a reload keeps it. No session is created and nothing is
 * prompted.
 *
 * One tap adds one history entry (D8, seen 2026-10-03 at load 11): the tap pushed the chat view
 * before the selection, and the selection pushed the session once its read settled, so a read
 * slower than 400 ms left "chat, no session" between the board and the chat. The last legs slow
 * the tapped session's reads to make that window certain.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = "ef2cdf93e1ac";
const results = [];
const check = (name, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` (${detail})`}`);
};

const mainView = (page) => page.evaluate(() => document.querySelector("pi-web-app")?.state?.mainView ?? null);
const boardVisible = (page) => page.evaluate(() => {
  const all = (root, selector) => [...root.querySelectorAll(selector), ...[...root.querySelectorAll("*")].flatMap((node) => (node.shadowRoot === null ? [] : all(node.shadowRoot, selector)))];
  return all(document, "app-navigate-page").some((surface) => surface.getBoundingClientRect().width > 0);
});
const onBoard = async (page) => (await mainView(page)) === "navigation" && (await boardVisible(page));
const where = async (page) => `${String(await mainView(page))} ${new URL(page.url()).search}`;
const historyLength = (page) => page.evaluate(() => window.history.length);
const SESSION_READ = /\/sessions\/[^/]+\/(messages|transcript-tail|status|stream-snapshot)(?:\?|$)/u;

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}`);
  await page.waitForTimeout(6000);
  check("a workspace link with no session opens the board", await onBoard(page), await where(page));
  await page.reload();
  await page.waitForTimeout(6000);
  check("a reload stays on the board", await onBoard(page), await where(page));

  const row = page.locator("app-navigate-page button.row.session").first();
  await row.tap({ timeout: 5_000 });
  await page.waitForTimeout(4000);
  const opened = new URL(page.url()).searchParams.get("session");
  check("precondition: tapping a board row opens its chat", (await mainView(page)) === "chat" && opened !== null, await where(page));
  await page.goBack();
  await page.waitForTimeout(4000);
  check("Back from that chat returns to the board, and the URL names no session", (await onBoard(page)) && new URL(page.url()).searchParams.get("session") === null, await where(page));
  await page.reload();
  await page.waitForTimeout(6000);
  check("and a reload keeps the board", await onBoard(page), await where(page));
  await page.screenshot({ path: "/tmp/surfaces/board-url-reloaded-phone.png" });

  await page.close();
  const fresh = await context.newPage();
  await fresh.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}`);
  await fresh.waitForTimeout(6000);
  check("precondition: a fresh tab opens on the board", await onBoard(fresh), await where(fresh));
  let slowed = 0;
  await fresh.route(SESSION_READ, async (route) => {
    slowed += 1;
    await new Promise((resolve) => { setTimeout(resolve, 1500); });
    await route.continue();
  });
  const before = await historyLength(fresh);
  await fresh.locator("app-navigate-page button.row.session").first().tap({ timeout: 5_000 });
  await fresh.waitForTimeout(7000);
  const slowOpened = new URL(fresh.url()).searchParams.get("session");
  check("precondition: a tap whose reads take 1.5 s opens its chat", (await mainView(fresh)) === "chat" && slowOpened !== null && slowed > 0, `${await where(fresh)}, ${String(slowed)} slowed reads`);
  check("that tap adds one history entry", (await historyLength(fresh)) - before === 1, `${String(before)} -> ${String(await historyLength(fresh))}`);
  await fresh.unroute(SESSION_READ);
  await fresh.goBack();
  await fresh.waitForTimeout(4000);
  check("and Back from it returns to the board, naming no session", (await onBoard(fresh)) && new URL(fresh.url()).searchParams.get("session") === null, await where(fresh));
  await context.close();
} finally {
  await browser.close();
}
const failed = results.filter((pass) => !pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
