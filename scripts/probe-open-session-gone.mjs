import { chromium } from "@playwright/test";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * P2 slice b part 2 on the 8505 stack, phone 393x850 coarse (state-diagram D8; owner, 2026-10-01:
 * the open session deleted elsewhere is reported as deleted; Restore goes in the composer slot).
 *
 * Fixtures are copies of a small seed session (a normal provider, so opening one makes no model
 * call; the live probe session names the flaky probe provider, whose injected delays held the
 * page's reads for 18-25 s), made per run under new ids and removed at the end. The seed file is
 * only read.
 *
 * - G2: the open session is closed on the daemon and its file deleted; the reader leaves the tab and
 *   comes back, and the page reads it again (the daemon pushes no deletion; heads are B28). It must say the session no longer exists, select nothing, and keep
 *   the id in the URL.
 * - G3: a row the board still lists is deleted, then picked. It must land on the same words, not
 *   fail the tap. The copy is dated in the past so it is never the workspace's latest session,
 *   which a link without a session opens (B31) and would leave running on the daemon.
 * - G4: an archived session opened by link shows "This session is archived." with Restore in the
 *   composer slot; Restore brings the composer back.
 * - G5: Stop and Abort on a session no store holds answer 404 with session-not-found.
 * - Control: a link to the live session opens it with its composer.
 */
const BASE = "http://127.0.0.1:8505";
const PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = "ef2cdf93e1ac";
const CWD = "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";
const LIVE = "01a0f231-7591-717d-a5dd-db04f6f5d05a";
const SESSION_DIR = "/Users/hanxiao.du/.pi/agent/sessions/--Users-hanxiao.du-.pi-web-8505-pi-web-8505-seed-workspace--";
const GONE_WORDS = "This session no longer exists on Local.";
const SHOTS = "/var/folders/2x/hqbz74zs7fvdxf_53693r26h0000gp/T/.playwright-mcp";

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` (${detail})`}`);
};

const COPY_SOURCE = "01a05000-5eed-7c00-8000-0000000000e1";
const source = fs.readdirSync(SESSION_DIR).find((name) => name.endsWith(`_${COPY_SOURCE}.jsonl`));
if (source === undefined) throw new Error("the small seed session to copy is missing");
const created = [];

function copySession(label, now = new Date()) {
  const id = `0f0f0f0f-0000-7000-8000-${randomBytes(6).toString("hex")}`;
  const lines = fs.readFileSync(path.join(SESSION_DIR, source), "utf8").trim().split("\n");
  const header = JSON.parse(lines[0]);
  header.id = id;
  header.timestamp = now.toISOString();
  lines[0] = JSON.stringify(header);
  const last = JSON.parse(lines[lines.length - 1]);
  const name = `gone probe ${label} ${id.slice(-4)}`;
  lines.push(JSON.stringify({ type: "session_info", id: randomBytes(4).toString("hex"), parentId: last.id ?? null, timestamp: now.toISOString(), name }));
  const file = path.join(SESSION_DIR, `${now.toISOString().replace(/[:.]/gu, "-")}_${id}.jsonl`);
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
  created.push(file);
  return { id, name, file };
}

const post = async (route, body) => {
  const response = await fetch(`${BASE}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: response.status, json };
};
const located = async (id) => (await fetch(`${BASE}/api/machines/local/sessions/${encodeURIComponent(id)}/locate?cwd=${encodeURIComponent(CWD)}`)).status;

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  const link = (session) => `${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}${session === undefined ? "" : `&session=${session}`}`;
  const seen = () => page.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    const state = app?.state;
    const root = app?.shadowRoot;
    const visible = (selector) => [...(root?.querySelectorAll(selector) ?? [])].some((element) => element.checkVisibility());
    const target = root?.querySelector(".session-target");
    const strip = root?.querySelector(".archived-strip");
    return {
      selected: state?.selectedSession?.id,
      statusRead: state?.status !== undefined,
      archived: state?.selectedSession?.archived === true,
      target: state?.sessionTarget?.target?.kind,
      panel: target === null || target === undefined ? undefined : { text: target.querySelector("p")?.textContent ?? "", role: target.getAttribute("role"), button: target.querySelector("button")?.textContent ?? "" },
      strip: strip === null || strip === undefined ? undefined : strip.querySelector("p")?.textContent ?? "",
      composer: visible("prompt-editor"),
      failedLoad: root?.querySelector("chat-view")?.shadowRoot?.querySelector(".transcript-failed")?.textContent?.replace(/\s+/gu, " ").trim(),
      notice: state?.error ?? "",
      pending: state === undefined ? undefined : app.navigation?.view?.()?.phase,
      url: new URL(location.href).searchParams.get("session"),
      sessions: (state?.sessions ?? []).map((session) => session.id),
    };
  });
  const until = async (predicate, ms = 20_000) => {
    const deadline = Date.now() + ms;
    let last = await seen();
    while (Date.now() < deadline) {
      if (predicate(last)) return last;
      await page.waitForTimeout(250);
      last = await seen();
    }
    return last;
  };

  const a = copySession("A");
  const b = copySession("B", new Date("2026-08-01T00:00:00.000Z"));
  const c = copySession("C");
  await page.waitForTimeout(1500);
  const locates = await Promise.all([a, b, c].map((copy) => located(copy.id)));
  check("precondition: the daemon locates the three copies", locates.every((status) => status === 200), JSON.stringify(locates));

  await page.goto(link(LIVE));
  const control = await until((state) => state.selected === LIVE && state.composer);
  check("control: a link to the live session opens it with its composer", control.selected === LIVE && control.composer && control.strip === undefined, JSON.stringify({ selected: control.selected, composer: control.composer }));

  await page.goto(link(a.id));
  const aOpen = await until((state) => state.selected === a.id && state.statusRead);
  check("precondition G2: the copy opened by link and its status was read", aOpen.selected === a.id && aOpen.statusRead, JSON.stringify({ selected: aOpen.selected, statusRead: aOpen.statusRead }));
  await page.waitForTimeout(2000);
  const stopped = await post(`/api/sessions/${encodeURIComponent(a.id)}/stop`, { cwd: CWD });
  check("precondition G2: its runtime closed on the daemon", stopped.status === 200, `status ${String(stopped.status)}`);
  fs.rmSync(a.file);
  check("precondition G2: its file is deleted and the daemon no longer locates it", (await located(a.id)) === 404, "");
  const setVisibility = (state) => page.evaluate((next) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => next });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => next === "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
  await setVisibility("hidden");
  await page.waitForTimeout(1000);
  await setVisibility("visible");
  const g2 = await until((state) => state.panel !== undefined || state.failedLoad !== undefined, 30_000);
  check("G2: the open session deleted elsewhere says it no longer exists, with the way back", g2.panel?.text === GONE_WORDS && g2.panel.role === "alert" && /^Go to .+'s sessions$/u.test(g2.panel.button), JSON.stringify({ panel: g2.panel, failedLoad: g2.failedLoad, notice: g2.notice }));
  check("G2: nothing else is selected and the URL keeps the id", g2.selected === undefined && g2.url === a.id, JSON.stringify({ selected: g2.selected, url: g2.url }));
  await page.screenshot({ path: `${SHOTS}/p2b2-g2-open-session-gone-phone.png` });

  await page.goto(link());
  const board = await until((state) => state.sessions.includes(b.id));
  check("precondition G3: the board lists the copy", board.sessions.includes(b.id), `${String(board.sessions.length)} rows`);
  const bStopped = await post(`/api/sessions/${encodeURIComponent(b.id)}/stop`, { cwd: CWD });
  fs.rmSync(b.file);
  const bStatus = (await fetch(`${BASE}/api/machines/local/sessions/${encodeURIComponent(b.id)}/status?cwd=${encodeURIComponent(CWD)}`)).status;
  check("precondition G3: the deleted row is open nowhere on the daemon (no runtime, no file)", bStopped.status === 200 && bStatus === 404, `stop ${String(bStopped.status)}, status ${String(bStatus)}`);
  const picked = await page.evaluate((id) => {
    const app = document.querySelector("pi-web-app");
    const session = app?.state?.sessions?.find((candidate) => candidate.id === id);
    if (session === undefined) return false;
    void app.openSessionFromQuickSwitcher(session);
    return true;
  }, b.id);
  check("precondition G3: the deleted row was picked", picked, "");
  const g3 = await until((state) => state.panel !== undefined || state.pending === "failed", 20_000);
  check("G3: a picked row deleted since the board was read lands on the gone words, not a failed tap", g3.panel?.text === GONE_WORDS && g3.pending !== "failed", JSON.stringify({ panel: g3.panel, pending: g3.pending, failedLoad: g3.failedLoad }));
  check("G3: the URL names the picked row, so a reload shows the same answer", g3.url === b.id, `session=${String(g3.url)}`);

  const archived = await post(`/api/sessions/${encodeURIComponent(c.id)}/archive`, { cwd: CWD });
  check("precondition G4: the copy is archived", archived.status === 200, `status ${String(archived.status)}`);
  await page.goto(link(c.id));
  const g4 = await until((state) => state.selected === c.id && (state.strip !== undefined || state.archived));
  check("G4: an archived session opened by link says so in the composer slot, with no composer", g4.selected === c.id && g4.strip === "This session is archived." && !g4.composer, JSON.stringify({ selected: g4.selected, archived: g4.archived, strip: g4.strip, composer: g4.composer }));
  await page.screenshot({ path: `${SHOTS}/p2b2-g4-archived-strip-phone.png` });
  const restoreTapped = await page.locator("pi-web-app .archived-strip button").click({ timeout: 5000 }).then(() => true, () => false);
  const restored = await until((state) => !state.archived && state.composer);
  check("G4: Restore brings the composer back", restoreTapped && !restored.archived && restored.composer && restored.strip === undefined, JSON.stringify({ tapped: restoreTapped, archived: restored.archived, composer: restored.composer, strip: restored.strip }));

  const abort = await post(`/api/sessions/${encodeURIComponent(a.id)}/abort`, { cwd: CWD });
  const stop = await post(`/api/sessions/${encodeURIComponent(a.id)}/stop`, { cwd: CWD });
  check("G5: Abort on a session no store holds answers 404 with session-not-found", abort.status === 404 && abort.json?.code === "session-not-found", JSON.stringify(abort));
  check("G5: Stop on a session no store holds answers 404 with session-not-found", stop.status === 404 && stop.json?.code === "session-not-found", JSON.stringify(stop));
} finally {
  await browser.close();
  for (const file of created) fs.rmSync(file, { force: true });
}
const failed = results.filter((result) => !result.pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
