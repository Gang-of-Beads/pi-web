#!/usr/bin/env node
/**
 * Live check of D8 (docs/design/state-diagram.md), B29, at 393x850 under touch.
 *
 * Owner, 2026-09-30: "I tapped a page, but it hadn't loaded. pi web hurried to switch pages; it switched,
 * but the content hadn't refreshed. I kept operating on it, then the content refreshed and pi web changed the page in place". He chose: stay in place,
 * and make the tap visible.
 *
 * Two probe sessions get unique names so their rows can be found, and their first-page reads
 * are slowed at the network layer.
 *   A. Tap session A (read slowed 3 s): within 300 ms the Sessions page is still showing, the
 *      row is marked opening, a progress line runs, and the open session has not changed. After
 *      1.3 s the row says "Opening…". When the read lands, the chat shows A.
 *   B. Tap session B (read slowed 4 s), then go back to the chat before it lands: B is never
 *      selected, from the tap on, and 6 s later the page is still the chat the reader went back to.
 *   C. Tap session C while its read fails: the page stays, the row says it could not open, and
 *      the app announces it by name. A second tap, once the read works, opens C.
 */
import { chromium } from "playwright";

const BASE = process.env.PI_WEB_PROBE_BASE ?? "http://127.0.0.1:8505";
const PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = "ef2cdf93e1ac";
const CWD = `${process.env.HOME}/.pi-web-8505/pi-web-8505-seed-workspace`;
const HOME_SESSION = "01a05000-5eed-7c00-8000-0000000000c1";
const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
function leg(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` ${JSON.stringify(detail)}`}`);
}

const api = (path, init) => fetch(`${BASE}/api/${path}`, { headers: { "content-type": "application/json" }, ...init }).then((response) => response.json());
const listed = await api(`sessions?cwd=${encodeURIComponent(CWD)}`);
const sessions = (Array.isArray(listed) ? listed : listed.sessions ?? []).filter((session) => session.id !== HOME_SESSION && session.messageCount > 0 && session.archived !== true);
if (sessions.length < 3) throw new Error("precondition: the seed workspace needs three persisted sessions besides the home session");
const stamp = Date.now().toString(36);
const [a, b, c] = [{ ...sessions[0], label: `nav-probe-A-${stamp}` }, { ...sessions[1], label: `nav-probe-B-${stamp}` }, { ...sessions[2], label: `nav-probe-C-${stamp}` }];
for (const target of [a, b, c]) {
  await api(`sessions/${target.id}/commands/run`, { method: "POST", body: JSON.stringify({ cwd: CWD, text: `/name ${target.label}` }) });
}
await sleep(1000);

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const page = await context.newPage();
const slow = new Map([[a.id, 3000], [b.id, 4000]]);
let failC = true;
await page.route("**/sessions/*/messages*", async (route) => {
  if (failC && route.request().url().includes(`/sessions/${c.id}/messages`)) {
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "probe: read refused" }) });
    return;
  }
  const hit = [...slow.keys()].find((id) => route.request().url().includes(`/sessions/${id}/messages`));
  if (hit !== undefined) await sleep(slow.get(hit));
  await route.continue();
});

const facts = () => page.evaluate(() => {
  const app = document.querySelector("pi-web-app");
  const state = Reflect.get(app, "state");
  const root = app.shadowRoot;
  const opening = [...root.querySelectorAll("app-navigate-page")].flatMap((nav) => [...(nav.shadowRoot?.querySelectorAll("button.row.session.opening") ?? [])]).filter((row) => row.getClientRects().length > 0).map((row) => row.textContent.replace(/\s+/gu, " ").trim());
  return {
    selected: state.selectedSession?.id,
    view: state.mainView,
    sessionsPageShowing: Boolean(Reflect.get(app, "navigateOpen")) || state.mainView === "navigation",
    opening,
    progress: root.querySelector(".navigation-progress") !== null,
    announced: root.querySelector(".navigation-announcer")?.textContent?.trim() ?? "",
    failedRows: [...root.querySelectorAll("app-navigate-page")].flatMap((nav) => [...(nav.shadowRoot?.querySelectorAll(".opening-words.failed") ?? [])]).filter((row) => row.getClientRects().length > 0).map((row) => row.textContent.trim()),
  };
});

async function openSessionsPage() {
  await page.locator("app-context-bar button[aria-label='Open navigation']").tap();
  await sleep(1500);
}

try {
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${HOME_SESSION}&view=chat`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("pi-web-app");
  await sleep(6000);
  const booted = await facts();
  leg("precondition: the home session is open in the chat", booted.selected === HOME_SESSION && booted.view === "chat", booted);
  if (booted.selected !== HOME_SESSION) throw new Error("precondition failed");

  await openSessionsPage();
  const rowA = page.locator("app-navigate-page button.row.session:visible", { hasText: a.label }).first();
  leg("precondition: session A is listed on the Sessions page", await rowA.count() === 1, { label: a.label });
  await rowA.scrollIntoViewIfNeeded();
  await rowA.tap();
  await sleep(300);
  const tapped = await facts();
  leg("A: the tap answers at once and the page stays", tapped.sessionsPageShowing && tapped.selected === HOME_SESSION && tapped.opening.some((text) => text.includes(a.label)) && tapped.progress, tapped);
  await sleep(1000);
  const waiting = await facts();
  await page.screenshot({ path: "/tmp/navigation-intent-opening.png" });
  leg("A: after a second the row says Opening…", waiting.opening.some((text) => text.includes("Opening…")), waiting);
  await sleep(3000);
  const landed = await facts();
  leg("A: the chat shows A once its read lands", landed.selected === a.id && landed.view === "chat" && !landed.sessionsPageShowing && !landed.progress, landed);

  await openSessionsPage();
  const rowB = page.locator("app-navigate-page button.row.session:visible", { hasText: b.label }).first();
  leg("precondition: session B is listed on the Sessions page", await rowB.count() === 1, { label: b.label });
  await rowB.scrollIntoViewIfNeeded();
  await rowB.tap();
  const seen = new Set();
  for (let sample = 0; sample < 8; sample += 1) {
    seen.add((await facts()).selected);
    await sleep(100);
  }
  await page.goBack();
  await sleep(300);
  const wentBack = await facts();
  for (let sample = 0; sample < 12; sample += 1) {
    const now = await facts();
    seen.add(now.selected);
    await sleep(500);
  }
  const settled = await facts();
  leg("B: going back while B loads keeps the reader where they went", wentBack.selected === a.id && settled.selected === a.id && settled.view === "chat" && !seen.has(b.id), { wentBack, settled, seen: [...seen] });

  await openSessionsPage();
  const rowC = page.locator("app-navigate-page button.row.session:visible", { hasText: c.label }).first();
  leg("precondition: session C is listed on the Sessions page", await rowC.count() === 1, { label: c.label });
  await rowC.scrollIntoViewIfNeeded();
  await rowC.tap();
  await sleep(1500);
  const refused = await facts();
  leg("C: a read that fails keeps the page, says so on the row, and names it aloud", refused.sessionsPageShowing && refused.selected === a.id && refused.failedRows.some((text) => text.includes("Couldn't open")) && refused.announced === `Couldn't open ${c.label}`, refused);
  const tileHeights = await page.evaluate((labels) => {
    const rows = [...document.querySelector("pi-web-app").shadowRoot.querySelectorAll("app-navigate-page")].flatMap((nav) => [...(nav.shadowRoot?.querySelectorAll("button.row.session") ?? [])]).filter((row) => row.getClientRects().length > 0);
    const height = (label) => Math.round(rows.find((row) => row.textContent.includes(label))?.getBoundingClientRect().height ?? -1);
    return labels.map(height);
  }, [c.label, a.label]);
  leg("C: the failed tile keeps the height every tile has (grid rows stretch, so compare across rows)", tileHeights[0] > 0 && tileHeights[0] === tileHeights[1], { failed: tileHeights[0], anotherRow: tileHeights[1] });
  await page.screenshot({ path: "/tmp/navigation-intent-failed.png" });
  failC = false;
  await rowC.tap();
  await sleep(2500);
  const retried = await facts();
  leg("C: tapping again once the read works opens C", retried.selected === c.id && retried.view === "chat" && !retried.sessionsPageShowing, retried);
  await page.screenshot({ path: "/tmp/navigation-intent-phone.png" });
} catch (error) {
  leg("probe ran", false, { error: String(error) });
} finally {
  await browser.close();
}

const failed = results.filter((ok) => !ok).length;
console.log(`${String(results.length - failed)}/${String(results.length)} legs passed`);
process.exit(failed === 0 ? 0 : 1);
