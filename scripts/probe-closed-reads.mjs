import { chromium } from "@playwright/test";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Reading a closed session never opens it (state-diagram D5; P3 slice d), 8505, 393x850.
 *
 * Opens an archived copy of a small seed session by link, which reads its transcript and its
 * background tasks. The daemon's status catalogue (`sessions/statuses`) lists every session with
 * an open runtime, which makes it the proof of an open. The archived copy must not appear in it
 * and must show no startup notice. A closed live copy opened the same way is the control: its
 * status read opens it (a read of live runtime state), so it does appear.
 */
const BASE = "http://127.0.0.1:8505";
const CWD = "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";
const SESSION_DIR = "/Users/hanxiao.du/.pi/agent/sessions/--Users-hanxiao.du-.pi-web-8505-pi-web-8505-seed-workspace--";
const COPY_SOURCE = "01a05000-5eed-7c00-8000-0000000000e1";
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` (${detail})`}`);
};
const created = [];
const source = fs.readdirSync(SESSION_DIR).find((name) => name.endsWith(`_${COPY_SOURCE}.jsonl`));
if (source === undefined) throw new Error("the small seed session to copy is missing");

function copySession(label) {
  const id = `0c0c0c0c-0000-7000-8000-${randomBytes(6).toString("hex")}`;
  const lines = fs.readFileSync(path.join(SESSION_DIR, source), "utf8").trim().split("\n");
  const header = JSON.parse(lines[0]);
  header.id = id;
  lines[0] = JSON.stringify(header);
  const last = JSON.parse(lines[lines.length - 1]);
  lines.push(JSON.stringify({ type: "session_info", id: randomBytes(4).toString("hex"), parentId: last.id ?? null, timestamp: "2026-08-01T00:00:00.000Z", name: `closed-reads ${label} ${id.slice(-4)}` }));
  const file = path.join(SESSION_DIR, `2026-08-01T00-00-00-000Z_${id}.jsonl`);
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
  created.push(file);
  return { id, file };
}

const openRuntimes = async () => {
  const response = await fetch(`${BASE}/api/machines/local/sessions/statuses`);
  const body = await response.json();
  return new Set((body.statuses ?? []).map((status) => status.sessionId));
};
const post = (route, body) => fetch(`${BASE}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const browser = await chromium.launch();
try {
  const archived = copySession("archived");
  const live = copySession("live");
  await new Promise((resolve) => { setTimeout(resolve, 1500); });
  const archivedStatus = (await post(`/api/sessions/${encodeURIComponent(archived.id)}/archive`, { cwd: CWD })).status;
  const openedByArchiving = (await openRuntimes()).has(archived.id);
  console.log(`observation: archiving ${openedByArchiving ? "opened" : "did not open"} a runtime`);
  await post(`/api/sessions/${encodeURIComponent(archived.id)}/stop`, { cwd: CWD });
  await post(`/api/sessions/${encodeURIComponent(live.id)}/stop`, { cwd: CWD });
  const before = await openRuntimes();
  check("precondition: one copy is archived and neither has a runtime", archivedStatus === 200 && !before.has(archived.id) && !before.has(live.id), `archive ${String(archivedStatus)}`);

  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  const seen = () => page.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    const state = app?.state;
    const text = (() => { const all = []; const walk = (root) => { for (const element of root.querySelectorAll("*")) if (element.shadowRoot) walk(element.shadowRoot); all.push(root.textContent ?? ""); }; walk(document); return all.join(" ").replace(/\s+/gu, " "); })();
    return { selected: state?.selectedSession?.id, archived: state?.selectedSession?.archived === true, messages: (state?.messages ?? []).length, loading: state?.isLoadingTranscript, startupNotice: /Loading session extensions|Opening session/u.test(text), strip: text.includes("This session is archived.") };
  });
  const link = (id) => `${BASE}/?project=991606fd-e498-4b93-a1ce-2af09efdb0e7&workspace=ef2cdf93e1ac&session=${id}`;

  await page.goto(link(archived.id));
  await page.waitForTimeout(6000);
  const a = await seen();
  check("precondition: the archived copy opened by link, read-only, with its transcript", a.selected === archived.id && a.archived && a.messages > 0 && a.loading === false, JSON.stringify(a));
  const afterArchived = await openRuntimes();
  check("an archived session opened by link starts no runtime", !afterArchived.has(archived.id), `open: ${String(afterArchived.has(archived.id))}`);
  check("an archived session shows no startup notice", !a.startupNotice && a.strip, JSON.stringify({ startupNotice: a.startupNotice, strip: a.strip }));
  await page.screenshot({ path: "/var/folders/2x/hqbz74zs7fvdxf_53693r26h0000gp/T/.playwright-mcp/p3d-archived-no-runtime-phone.png" });

  await page.goto(link(live.id));
  await page.waitForTimeout(6000);
  const l = await seen();
  check("precondition: the closed live copy opened by link", l.selected === live.id && l.messages > 0, JSON.stringify(l));
  check("control: a live session's status read does open its runtime, so the check sees an open", (await openRuntimes()).has(live.id), "");
} finally {
  await browser.close();
  for (const file of created) fs.rmSync(file, { force: true });
}
const failed = results.filter((result) => !result.pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
