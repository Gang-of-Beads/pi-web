import { chromium } from "@playwright/test";

/**
 * The session board never gives up, and claims emptiness only once every
 * source answered (B48, B8, P1 slice 5).
 *
 * Found live while probing slice 4: with the projects read answering 500, the
 * navigation board said "No sessions yet." on a machine that has sessions,
 * and nothing read it again. A workspace whose sessions read failed was also
 * dropped from the board without a trace.
 *
 * Phone 393x850, coarse pointer, the Sessions view:
 * - A: the projects read answers 500 for 6 s from boot. Expect no "No sessions
 *   yet.", "Loading sessions…" or "Failed to load sessions" while it is
 *   unanswered, and the board's rows to appear by themselves.
 * - B: one workspace's sessions read is lost for 6 s. The other rows show at
 *   once, "No sessions yet." never shows, and the lost workspace's session
 *   appears by itself once it answers. Once the other rows show, the retries
 *   ask only the lost workspace: on 8504 each sessions listing is a
 *   whole-store scan on the daemon.
 */
const BASE = process.env.PI_WEB_PROBE_BASE ?? process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const PROJECTS_READ = /\/api\/machines\/local\/projects$/u;
const LOSS_MS = 6000;
const DEAD_ENDS = ["No sessions yet", "Loading sessions", "Failed to load sessions"];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
function leg(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` - ${detail}`}`);
}

async function boardSeen(page) {
  return page.evaluate(() => {
    const deepText = (node) => [...node.childNodes].map((child) => (child.nodeType === Node.TEXT_NODE ? child.textContent : deepText(child))).join(" ") + (node.shadowRoot ? deepText(node.shadowRoot) : "");
    const app = document.querySelector("pi-web-app");
    const rows = app === null ? [] : Reflect.get(app, "quickSwitcherSessions") ?? [];
    return { text: deepText(document.body).replace(/\s+/gu, " "), rowCwds: rows.map((row) => row.cwd), rowCount: rows.length };
  });
}

async function watchBoard(page, until, timeoutMs = 30_000) {
  const deadEnds = new Set();
  let healedAt;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const seen = await boardSeen(page);
    for (const deadEnd of DEAD_ENDS) if (seen.text.includes(deadEnd)) deadEnds.add(deadEnd);
    if (healedAt === undefined && until(seen)) healedAt = Date.now() - started;
    if (healedAt !== undefined && Date.now() - started > healedAt + 1500) break;
    await sleep(200);
  }
  return { deadEnds: [...deadEnds], healedAt };
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));

  const control = await context.newPage();
  await control.goto(`${BASE}/?view=sessions`, { waitUntil: "domcontentloaded" });
  const settled = await watchBoard(control, (seen) => seen.rowCount > 0, 15_000);
  const baseline = await boardSeen(control);
  await control.close();
  const cwds = [...new Set(baseline.rowCwds)];
  leg("precondition: with nothing lost, the board lists sessions from at least two workspaces", settled.healedAt !== undefined && cwds.length >= 2, `${String(baseline.rowCount)} rows in ${String(cwds.length)} workspaces`);

  const a = await context.newPage();
  let aFailed = 0;
  let aUntil;
  await a.route(PROJECTS_READ, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    aUntil ??= Date.now() + LOSS_MS;
    if (Date.now() < aUntil) {
      aFailed += 1;
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Project store is locked" }) });
    }
    return route.continue();
  });
  await a.goto(`${BASE}/?view=sessions`, { waitUntil: "domcontentloaded" });
  const aSeen = await watchBoard(a, (seen) => seen.rowCount > 0);
  await a.close();
  leg("precondition A: the projects read answered 500 for 6 s", aFailed >= 2, `failed ${String(aFailed)}`);
  leg("A: the board lists its sessions by itself once the projects answer", aSeen.healedAt !== undefined, `healed at ${String(aSeen.healedAt)} ms`);
  leg("A: no empty claim, reading text or failure while it waits", aSeen.deadEnds.length === 0, JSON.stringify(aSeen.deadEnds));

  const lostCwd = cwds[0];
  const b = await context.newPage();
  let bFailed = 0;
  let bUntil;
  let rowsShownAt;
  const otherSessionReads = [];
  b.on("request", (request) => {
    const url = new URL(request.url());
    if (rowsShownAt === undefined || !url.pathname.endsWith("/api/machines/local/sessions")) return;
    const cwd = url.searchParams.get("cwd");
    if (cwd !== null && cwd !== lostCwd) otherSessionReads.push(cwd);
  });
  await b.route((url) => url.pathname.endsWith("/api/machines/local/sessions") && url.searchParams.get("cwd") === lostCwd, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    bUntil ??= Date.now() + LOSS_MS;
    if (Date.now() < bUntil) {
      bFailed += 1;
      return route.abort("connectionreset");
    }
    return route.continue();
  });
  await b.goto(`${BASE}/?view=sessions`, { waitUntil: "domcontentloaded" });
  const early = await watchBoard(b, (seen) => seen.rowCount > 0, 5000);
  rowsShownAt = Date.now();
  const earlySeen = await boardSeen(b);
  const bSeen = await watchBoard(b, (seen) => seen.rowCwds.includes(lostCwd));
  await b.close();
  leg("precondition B: one workspace's sessions read was lost", bFailed >= 1, `failed ${String(bFailed)} for ${String(lostCwd)}`);
  leg("B: the other workspaces' sessions show at once", early.healedAt !== undefined && earlySeen.rowCwds.some((cwd) => cwd !== lostCwd), `${String(earlySeen.rowCount)} rows early`);
  leg("B: the lost workspace's sessions appear by themselves once it answers", bSeen.healedAt !== undefined, `healed at ${String(bSeen.healedAt)} ms`);
  leg("B: after the rows show, the retries ask only the lost workspace", otherSessionReads.length === 0, `${String(otherSessionReads.length)} other sessions reads`);
  leg("B: no empty claim or failure while it waits", [...new Set([...early.deadEnds, ...bSeen.deadEnds])].length === 0, JSON.stringify([...new Set([...early.deadEnds, ...bSeen.deadEnds])]));
} finally {
  await browser.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${String(results.length - failed)}/${String(results.length)} legs passed`);
process.exit(failed === 0 ? 0 : 1);
