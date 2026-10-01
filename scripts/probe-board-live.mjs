import { chromium } from "@playwright/test";

/**
 * The board takes its machine's announcements (state-diagram D5; O-P9), 8505, phone 393x850.
 *
 * A session renamed or started on another device stayed stale on the board, and in the quick
 * switcher, until the next whole board read. The probe does both through the machine's API, as
 * another device would, while the page shows the board:
 * - a session started in a listed workspace joins the board within 2 s, with no board read;
 * - renaming that session shows on its row within 2 s, with no board read.
 * Control: the board was read once at boot and every source answered. It touches only the session
 * it starts, and archives it at the end.
 */
const BASE = "http://127.0.0.1:8505";
const WORKSPACE_PATH = `${process.env.HOME ?? ""}/.pi-web-8505/pi-web-8505-seed-workspace`;
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` (${detail})`}`);
};
const api = (path, body) => fetch(`${BASE}/api/machines/local${path}`, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const browser = await chromium.launch();
let started;
try {

  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  const boardReads = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname.endsWith("/session-board")) boardReads.push(Date.now()); });
  await page.goto(`${BASE}/?view=sessions`);
  await page.waitForTimeout(8_000);
  const boardRow = (id) => page.evaluate((sessionId) => {
    const board = document.querySelector("pi-web-app")?.sessionBoards?.board("local");
    const row = board?.sessions.find((session) => session.id === sessionId);
    return { known: board !== undefined, unknown: board?.unknownSources.length, row: row === undefined ? undefined : { name: row.name ?? null } };
  }, id);
  const before = await boardRow("none");
  check("control: the board was read once and every source answered", boardReads.length === 1 && before.known && before.unknown === 0, `${String(boardReads.length)} reads, ${String(before.unknown)} unknown`);

  const startedAt = Date.now();
  const answer = await api("/sessions", { cwd: WORKSPACE_PATH });
  started = answer.status === 200 ? await answer.json() : undefined;
  let startShownAfter;
  for (let waited = 0; waited <= 2_000 && started !== undefined; waited += 100) {
    if ((await boardRow(started.id)).row !== undefined) { startShownAfter = Date.now() - startedAt; break; }
    await page.waitForTimeout(100);
  }
  check("precondition: the machine started a session", started !== undefined, String(answer.status));
  check("a session started elsewhere joins the board within 2 s, with no board read", startShownAfter !== undefined && boardReads.filter((at) => at >= startedAt).length === 0, `after ${String(startShownAfter)} ms, ${String(boardReads.filter((at) => at >= startedAt).length)} board reads`);

  const newName = `Board live ${String(Date.now()).slice(-6)}`;
  const renamedAt = Date.now();
  const renamed = started === undefined ? undefined : await api(`/sessions/${started.id}/commands/run`, { cwd: WORKSPACE_PATH, text: `/name ${newName}` });
  let renameShownAfter;
  for (let waited = 0; waited <= 2_000 && started !== undefined; waited += 100) {
    if ((await boardRow(started.id)).row?.name === newName) { renameShownAfter = Date.now() - renamedAt; break; }
    await page.waitForTimeout(100);
  }
  check("precondition: the machine took the rename", renamed?.status === 200, String(renamed?.status));
  check("a rename made elsewhere shows on the board within 2 s, with no board read", renameShownAfter !== undefined && boardReads.filter((at) => at >= renamedAt).length === 0, `after ${String(renameShownAfter)} ms, ${String(boardReads.filter((at) => at >= renamedAt).length)} board reads`);
  await page.screenshot({ path: "/var/folders/2x/hqbz74zs7fvdxf_53693r26h0000gp/T/.playwright-mcp/op9-board-live-phone.png" });
} finally {
  if (started !== undefined) await api(`/sessions/${started.id}/archive`, { cwd: WORKSPACE_PATH }).catch(() => undefined);
  await browser.close();
}
const failed = results.filter((result) => !result.pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
