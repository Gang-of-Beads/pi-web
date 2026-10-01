import { chromium } from "@playwright/test";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * The board takes its machine's announcements (state-diagram D5; O-P9), 8505, phone 393x850.
 *
 * A session renamed or started on another device stayed stale on the board, and in the quick
 * switcher, until the next whole board read. The probe does both through the machine's API, as
 * another device would, while the page shows the board:
 * - a session started in a listed workspace joins the board within 2 s, with no board read;
 * - renaming that session shows on its row within 2 s, with no board read;
 * - a copy made elsewhere (/clone of a copied small seed, since a clone needs a saved session) joins
 *   the board within 2 s, under its name, with no board read.
 * Control: the board was read once at boot and every source answered. It touches only the sessions
 * it starts, copies or clones; it archives them and removes the copied seed file at the end.
 */
const BASE = "http://127.0.0.1:8505";
const WORKSPACE_PATH = `${process.env.HOME ?? ""}/.pi-web-8505/pi-web-8505-seed-workspace`;
const SESSION_DIR = `${process.env.HOME ?? ""}/.pi/agent/sessions/--Users-hanxiao.du-.pi-web-8505-pi-web-8505-seed-workspace--`;
const COPY_SOURCE = "01a05000-5eed-7c00-8000-0000000000e1";
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` (${detail})`}`);
};
const api = (path, body) => fetch(`${BASE}/api/machines/local${path}`, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const browser = await chromium.launch();
let started;
let copied;
let seedCopy;
function copySeed() {
  const source = fs.readdirSync(SESSION_DIR).find((name) => name.endsWith(`_${COPY_SOURCE}.jsonl`));
  if (source === undefined) return undefined;
  const id = `0c0c0c0c-0000-7000-8000-${randomBytes(6).toString("hex")}`;
  const lines = fs.readFileSync(path.join(SESSION_DIR, source), "utf8").trim().split("\n");
  const header = JSON.parse(lines[0]);
  header.id = id;
  lines[0] = JSON.stringify(header);
  const file = path.join(SESSION_DIR, `2026-08-01T00-00-00-000Z_${id}.jsonl`);
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
  return { id, file };
}
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
  seedCopy = copySeed();
  const clonedAt = Date.now();
  const cloned = seedCopy === undefined ? undefined : await api(`/sessions/${seedCopy.id}/commands/run`, { cwd: WORKSPACE_PATH, text: "/clone" });
  const cloneAnswer = cloned?.status === 200 ? await cloned.json() : undefined;
  const cloneAnsweredAt = Date.now();
  copied = cloneAnswer?.session;
  let copyShownAfter;
  let copyRow;
  for (let waited = 0; waited <= 2_000 && copied !== undefined; waited += 100) {
    copyRow = (await boardRow(copied.id)).row;
    if (copyRow !== undefined) { copyShownAfter = Date.now() - cloneAnsweredAt; break; }
    await page.waitForTimeout(100);
  }
  check("precondition: the machine made a copy under a new id", copied !== undefined && copied.id !== seedCopy?.id, `${String(cloned?.status)} ${String(cloneAnswer?.message)}`);
  check("a copy made elsewhere joins the board within 2 s of the machine's answer, under its name, with no board read", copyShownAfter !== undefined && typeof copyRow?.name === "string" && copyRow.name !== "" && boardReads.filter((at) => at >= clonedAt).length === 0, `after ${String(copyShownAfter)} ms (the copy took ${String(cloneAnsweredAt - clonedAt)} ms), name ${JSON.stringify(copyRow?.name)}, ${String(boardReads.filter((at) => at >= clonedAt).length)} board reads`);
  await page.screenshot({ path: "/var/folders/2x/hqbz74zs7fvdxf_53693r26h0000gp/T/.playwright-mcp/op9-board-live-phone.png" });
} finally {
  if (copied !== undefined) await api(`/sessions/${copied.id}/archive`, { cwd: WORKSPACE_PATH }).catch(() => undefined);
  if (seedCopy !== undefined) {
    await api(`/sessions/${seedCopy.id}/archive`, { cwd: WORKSPACE_PATH }).catch(() => undefined);
    fs.rmSync(seedCopy.file, { force: true });
  }
  if (started !== undefined) await api(`/sessions/${started.id}/archive`, { cwd: WORKSPACE_PATH }).catch(() => undefined);
  await browser.close();
}
const failed = results.filter((result) => !result.pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
