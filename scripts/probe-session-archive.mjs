import { createServer } from "node:http";
import { chromium } from "@playwright/test";

/**
 * The Sessions page archives, restores and deletes, and its row menu folds on a second tap.
 *
 * Owner, 2026-09-30: sessions had no Archive and no Delete after the old list was removed,
 * and a second tap on the row's ⋯ did not close its menu. Decisions: Archive in the menu,
 * archived sessions in a collapsed group at the bottom, Delete permanently only from there.
 * This drives the real page on 8505 at 393x850 with touch, against a session created for
 * the probe (a warm-up turn through the `pi-web-probe/flaky` provider makes it persisted
 * and listed), and checks each step against the daemon's own listing.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const CWD = process.env.PROBE_CWD ?? "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";
const LABEL = `archive-probe-${Date.now().toString(36)}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
function leg(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` - ${detail}`}`);
}

const server = createServer((request, response) => {
  request.resume();
  request.on("end", () => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    const chunk = (delta, finish) => `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "flaky", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    response.write(chunk({ role: "assistant", content: LABEL }, null));
    response.write(chunk({}, "stop"));
    response.end("data: [DONE]\n\n");
  });
});
await new Promise((resolve) => server.listen(18999, "127.0.0.1", resolve));

const api = (path, init) => fetch(`${BASE}/api/${path}`, { headers: { "content-type": "application/json" }, ...init }).then((response) => response.json());
const created = await api("sessions", { method: "POST", body: JSON.stringify({ cwd: CWD }) });
const sessionId = created.id;
if (typeof sessionId !== "string") throw new Error(`no session: ${JSON.stringify(created)}`);
const selected = await api(`sessions/${sessionId}/model`, { method: "POST", body: JSON.stringify({ cwd: CWD, provider: "pi-web-probe", modelId: "flaky" }) });
if (selected?.model?.provider !== "pi-web-probe") throw new Error("the probe model is not selectable (is the fixture loaded?)");
await api(`sessions/${sessionId}/prompt`, { method: "POST", body: JSON.stringify({ cwd: CWD, text: LABEL }) });
for (let attempt = 0; attempt < 60; attempt += 1) {
  await sleep(1000);
  if ((await api(`sessions/${sessionId}/status?cwd=${encodeURIComponent(CWD)}`)).isStreaming !== true) break;
}
const listed = async () => {
  const body = await api(`sessions?cwd=${encodeURIComponent(CWD)}`);
  const sessions = Array.isArray(body) ? body : body.sessions ?? [];
  return sessions.find((session) => session.id === sessionId);
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  page.on("dialog", (dialog) => { void dialog.accept(); });
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  const nav = page.locator("app-navigate-page");
  const rowWrap = () => nav.locator(".row-wrap", { hasText: LABEL }).first();
  const menuItems = () => nav.locator('[role="menuitem"]').allTextContents().then((items) => items.map((item) => item.trim()));
  const panels = () => nav.locator(".action-menu-panel").count();
  const tapKey = async () => {
    await rowWrap().scrollIntoViewIfNeeded();
    const box = await rowWrap().locator(".action-menu-toggle").boundingBox();
    if (box === null) throw new Error("the row's menu key is not on screen");
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(400);
  };
  const tapItem = async (label) => {
    const box = await nav.locator('[role="menuitem"]', { hasText: label }).first().boundingBox();
    if (box === null) throw new Error(`no menu item "${label}"`);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  };

  let onPage = false;
  for (let attempt = 0; attempt < 40 && !onPage; attempt += 1) {
    onPage = (await rowWrap().count()) > 0;
    if (!onPage) await sleep(500);
  }
  leg("precondition: the Sessions page lists the probe session", onPage);
  if (!onPage) throw new Error("the probe session is not on the Sessions page; every other leg would be vacuous");
  await rowWrap().scrollIntoViewIfNeeded();

  await tapKey();
  leg("precondition: a tap on the row's key opens its menu", (await panels()) === 1);
  await tapKey();
  leg("a second tap on the same key closes the menu", (await panels()) === 0, `panels open: ${String(await panels())}`);

  await tapKey();
  const items = await menuItems();
  leg("the menu offers Archive", items.includes("Archive"), JSON.stringify(items));
  if (!items.includes("Archive")) throw new Error("no Archive to press; the remaining legs would be vacuous");
  await tapItem("Archive");
  let archived = false;
  for (let attempt = 0; attempt < 20 && !archived; attempt += 1) {
    await sleep(500);
    archived = (await listed())?.archived === true;
  }
  leg("the daemon lists the session as archived", archived);
  await sleep(1000);
  const toggle = nav.locator(".archived-toggle");
  leg("the row left the live list and the Archived group is collapsed", (await rowWrap().count()) === 0 && (await toggle.getAttribute("aria-expanded")) === "false", `rows: ${String(await rowWrap().count())}, group: ${String(await toggle.textContent())}`);
  await toggle.scrollIntoViewIfNeeded();
  await toggle.tap();
  await sleep(500);
  leg("opening the Archived group shows it", (await rowWrap().count()) === 1);

  await tapKey();
  const archivedItems = await menuItems();
  leg("an archived row offers Restore and Delete permanently", JSON.stringify(archivedItems) === JSON.stringify(["Open", "Restore", "Delete permanently"]), JSON.stringify(archivedItems));
  await tapItem("Restore");
  let restored = false;
  for (let attempt = 0; attempt < 20 && !restored; attempt += 1) {
    await sleep(500);
    restored = (await listed())?.archived !== true;
  }
  leg("Restore brings it back in the daemon's listing", restored);

  await sleep(1000);
  await rowWrap().scrollIntoViewIfNeeded();
  await tapKey();
  await tapItem("Archive");
  await sleep(2000);
  if ((await nav.locator(".archived-toggle").getAttribute("aria-expanded")) === "false") await nav.locator(".archived-toggle").tap();
  await sleep(500);
  await rowWrap().scrollIntoViewIfNeeded();
  await tapKey();
  await tapItem("Delete permanently");
  let deleted = false;
  for (let attempt = 0; attempt < 20 && !deleted; attempt += 1) {
    await sleep(500);
    deleted = (await listed()) === undefined;
  }
  leg("Delete permanently removes it from the daemon's listing", deleted);
  await sleep(1000);
  leg("and from the page", (await rowWrap().count()) === 0);
  await page.screenshot({ path: "/tmp/journeys/session-archive.png" });
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? `ALL ${String(results.length)} LEGS PASS` : `${String(failed)} of ${String(results.length)} LEGS FAILED`);
process.exitCode = failed === 0 ? 0 : 1;
