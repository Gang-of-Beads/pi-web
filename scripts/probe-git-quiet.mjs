import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

/**
 * The git panel reads its status only while someone looks (state-diagram D5 "Git status"; P5
 * slice c), 8505, phone 393x850 coarse.
 *
 * The host keeps the active workspace panel rendered while the phone shows the chat, and the
 * panel read its status every 8 s for as long as it was rendered: 7 reads a minute unseen.
 * - control: the panel on screen keeps reading every 8 s;
 * - the chat on screen with the panel rendered but hidden: no status reads in 40 s;
 * - a file written in the workspace while the panel is hidden still refreshes it through
 *   `workspace.changed` (needs an open runtime in the workspace, which the daemon watches);
 * - back on the panel: one read within 3 s;
 * - the panel on screen in a hidden tab: no status reads in 24 s, and one read within 3 s of the
 *   tab coming back.
 */
const BASE = "http://127.0.0.1:8505";
const PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = "ef2cdf93e1ac";
const SESSION = "01a05000-5eed-7c00-8000-0000000000e1";
const WORKSPACE_PATH = `${process.env.HOME ?? ""}/.pi-web-8505/pi-web-8505-seed-workspace`;
const TOUCHED = join(WORKSPACE_PATH, ".probe-git-quiet-touch");
const TOOL = "git:workspace.git";
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` (${detail})`}`);
};

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  const statusReads = [];
  page.on("request", (request) => { if (/\/plugin-backends\/git\/.*\/status/u.test(request.url())) statusReads.push(Date.now()); });
  const readsSince = (at) => statusReads.filter((time) => time >= at).length;
  const mainView = () => page.evaluate(() => document.querySelector("pi-web-app")?.state?.mainView);
  const showView = (view) => page.evaluate((next) => { document.querySelector("pi-web-app")?.showView(next); }, view);
  const panelState = () => page.locator("section.git-panel").first().evaluate((element) => ({ rendered: true, visible: element.checkVisibility() })).catch(() => ({ rendered: false, visible: false }));

  const loadStart = Date.now();
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${SESSION}&tool=${encodeURIComponent(TOOL)}&view=${encodeURIComponent(TOOL)}`);
  await page.waitForTimeout(8_000);
  const opened = await panelState();
  check("precondition: the git panel is on screen and read the status", (await mainView()) === TOOL && opened.visible && readsSince(loadStart) >= 1, `${JSON.stringify(opened)}, reads ${String(readsSince(loadStart))}`);

  const shownStart = Date.now();
  await page.waitForTimeout(40_000);
  check("control: the panel on screen reads every 8 s", readsSince(shownStart) >= 4, `reads ${String(readsSince(shownStart))} in 40 s`);

  await showView("chat");
  await page.waitForTimeout(1_000);
  const hidden = await panelState();
  check("precondition: the chat is on screen and the panel is rendered but hidden", (await mainView()) === "chat" && hidden.rendered && !hidden.visible, JSON.stringify(hidden));
  const chatStart = Date.now();
  await page.waitForTimeout(40_000);
  check("the hidden panel reads no status for 40 s", readsSince(chatStart) === 0, `reads ${String(readsSince(chatStart))}`);

  const statuses = await (await fetch(`${BASE}/api/machines/local/sessions/statuses`)).json();
  const watched = Array.isArray(statuses?.statuses) && statuses.statuses.some((status) => status.sessionId === SESSION);
  check("precondition: a session in the workspace has an open runtime, so the daemon watches it", watched, "");
  const touchedAt = Date.now();
  await writeFile(TOUCHED, String(touchedAt));
  let changedAfter;
  for (let waited = 0; waited <= 5_000; waited += 100) {
    if (readsSince(touchedAt) > 0) { changedAfter = Date.now() - touchedAt; break; }
    await page.waitForTimeout(100);
  }
  check("a file written while the panel is hidden still refreshes it (workspace.changed)", changedAfter !== undefined, `after ${String(changedAfter)} ms`);
  await rm(TOUCHED, { force: true });
  await page.waitForTimeout(5_000);

  const back = Date.now();
  await showView(TOOL);
  let returnedAfter;
  for (let waited = 0; waited <= 3_000; waited += 100) {
    if (readsSince(back) > 0) { returnedAfter = Date.now() - back; break; }
    await page.waitForTimeout(100);
  }
  check("back on the panel, it reads the status within 3 s", returnedAfter !== undefined, `after ${String(returnedAfter)} ms`);

  await page.waitForTimeout(1_000);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }); });
  const tabHiddenStart = Date.now();
  await page.waitForTimeout(24_000);
  const tabHiddenReads = readsSince(tabHiddenStart);
  const tabBack = Date.now();
  await page.evaluate(() => {
    Reflect.deleteProperty(document, "visibilityState");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  let tabBackAfter;
  for (let waited = 0; waited <= 3_000; waited += 100) {
    if (readsSince(tabBack) > 0) { tabBackAfter = Date.now() - tabBack; break; }
    await page.waitForTimeout(100);
  }
  check("precondition: the panel is still on screen", (await panelState()).visible, "");
  check("in a hidden tab, the panel reads no status for 24 s", tabHiddenReads === 0, `reads ${String(tabHiddenReads)}`);
  check("the tab coming back reads the status within 3 s", tabBackAfter !== undefined, `after ${String(tabBackAfter)} ms`);
  await page.screenshot({ path: "/var/folders/2x/hqbz74zs7fvdxf_53693r26h0000gp/T/.playwright-mcp/p5c-git-panel-phone.png" });
} finally {
  await rm(TOUCHED, { force: true });
  await browser.close();
}
const failed = results.filter((result) => !result.pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
