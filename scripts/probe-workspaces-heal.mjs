import { chromium } from "@playwright/test";

/**
 * A project's workspaces read that got no answer heals by itself (B48, object
 * model §1.4, P1 slice 2).
 *
 * Before: one lost answer painted the error row, left the project with no
 * workspace list and nothing that would read it again, and the panel said
 * "No workspaces found" for a project that has them. Now the listing is read
 * again on its own, the preferred workspace opens when it answers, and
 * nothing claims a failure or an empty list meanwhile. One project that does
 * not answer retries silently: the app row speaks only for the machine.
 *
 * Phone 393x850, coarse pointer. The browser loses a project's workspaces
 * answers:
 * - A: the page opens the project by link and the first answer is lost (the
 *   boot restore has its own retry ladder, so this leg passed before too);
 * - B: the same, with every answer lost for 6 s;
 * - C: the reader taps another project on the board and its first answer is
 *   lost; no ladder covers a tap, so only the listing's own retry heals it.
 * A control leg with nothing lost proves the signal: the app selects a
 * workspace of the project. Each lossy leg asserts it healed without input, and
 * that no dead-end text or error row showed while it waited.
 */
const BASE = process.env.PI_WEB_PROBE_BASE ?? process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const PROJECT_ID = process.env.PROBE_PROJECT_ID ?? "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const DEAD_ENDS = ["No workspaces found", "Could not load workspaces", "Loading workspaces", "No workspaces here yet", "Failed to fetch", "Connection problem", "Lost connection", "A request timed out"];
const TAPPED_PROJECT_ID = process.env.PROBE_TAPPED_PROJECT_ID ?? "f4ad2c1e-58eb-4a30-abd9-0f87eff30022";
const TAPPED_PROJECT_NAME = process.env.PROBE_TAPPED_PROJECT_NAME ?? "repo";
const workspacesRead = (projectId) => new RegExp(`/api/machines/local/projects/${projectId}/workspaces$`, "u");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait until the session board's reads at boot have settled. The board reads
 * every project's workspaces, and a tap made while that read is in flight
 * joins it rather than asking again, so the tap's own read would never be
 * seen by the interception installed after it.
 */
async function boardReadsQuiet(page) {
  let lastRead = Date.now();
  const onRequest = (request) => { if (/\/workspaces$|\/sessions\?cwd=/u.test(request.url())) lastRead = Date.now(); };
  page.on("request", onRequest);
  const started = Date.now();
  while (Date.now() - lastRead < 1500 && Date.now() - started < 20_000) await sleep(200);
  page.off("request", onRequest);
}

const results = [];
function leg(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` - ${detail}`}`);
}

async function openProjectWhileLosing(page, { lossMs, tap = false }) {
  const projectId = tap ? TAPPED_PROJECT_ID : PROJECT_ID;
  const read = workspacesRead(projectId);
  let before;
  if (tap) {
    await page.goto(`${BASE}/?view=sessions`, { waitUntil: "domcontentloaded" });
    await page.locator("nav.kinds button:visible", { hasText: /^\s*Projects\s*$/u }).first().click({ timeout: 10_000 });
    await page.locator("button.row:visible", { hasText: new RegExp(`^\\s*${TAPPED_PROJECT_NAME}\\b`, "u") }).first().waitFor({ timeout: 10_000 });
    await boardReadsQuiet(page);
    before = await page.evaluate(() => document.querySelector("pi-web-app")?.state?.selectedProject?.id);
  }
  let aborted = 0;
  let answered = 0;
  let firstOnly = lossMs === 0;
  const lossless = lossMs < 0;
  let lossUntil;
  await page.route(read, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    lossUntil ??= Date.now() + lossMs;
    if (!lossless && (firstOnly || Date.now() < lossUntil)) {
      firstOnly = false;
      aborted += 1;
      return route.abort("connectionreset");
    }
    answered += 1;
    return route.continue();
  });
  if (tap) await page.locator("button.row:visible", { hasText: new RegExp(`^\\s*${TAPPED_PROJECT_NAME}\\b`, "u") }).first().click();
  else await page.goto(`${BASE}/?machine=local&project=${PROJECT_ID}`, { waitUntil: "domcontentloaded" });
  const deadEnds = new Set();
  let errorRows = 0;
  let healedAt;
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    const seen = await page.evaluate(() => {
      const deepText = (node) => [...node.childNodes].map((child) => (child.nodeType === Node.TEXT_NODE ? child.textContent : deepText(child))).join(" ") + (node.shadowRoot ? deepText(node.shadowRoot) : "");
      const deepAlerts = (root) => [...root.querySelectorAll("*")].reduce((count, element) => count + (element.matches(".error[role=alert]") ? 1 : 0) + (element.shadowRoot ? deepAlerts(element.shadowRoot) : 0), 0);
      const state = document.querySelector("pi-web-app")?.state;
      return { text: deepText(document.body).replace(/\s+/gu, " "), alerts: deepAlerts(document), workspaceProject: state?.selectedWorkspace?.projectId };
    });
    for (const deadEnd of DEAD_ENDS) if (seen.text.includes(deadEnd)) deadEnds.add(deadEnd);
    errorRows = Math.max(errorRows, seen.alerts);
    if (healedAt === undefined && seen.workspaceProject === projectId) healedAt = Date.now() - started;
    if (healedAt !== undefined && Date.now() - started > healedAt + 1500) break;
    await sleep(200);
  }
  await page.unroute(read);
  return { aborted, answered, deadEnds: [...deadEnds], errorRows, healedAt, before };
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));

  const control = await openProjectWhileLosing(await context.newPage(), { lossMs: -1 });
  leg("control: with nothing lost, the project opens its workspace", control.aborted === 0 && control.healedAt !== undefined, `healed at ${String(control.healedAt)} ms`);

  const a = await openProjectWhileLosing(await context.newPage(), { lossMs: 0 });
  leg("precondition A: the first workspaces answer was lost", a.aborted === 1, `aborted ${String(a.aborted)}, answered ${String(a.answered)}`);
  leg("A: the project opens its workspace without input", a.healedAt !== undefined, `healed at ${String(a.healedAt)} ms`);
  leg("A: no dead-end text while it heals", a.deadEnds.length === 0, JSON.stringify(a.deadEnds));
  leg("A: no error row for a lost read", a.errorRows === 0, `error rows ${String(a.errorRows)}`);

  const b = await openProjectWhileLosing(await context.newPage(), { lossMs: 6000 });
  leg("precondition B: answers were lost for 6 s", b.aborted >= 2, `aborted ${String(b.aborted)}, answered ${String(b.answered)}`);
  leg("B: the project opens its workspace when answers flow again", b.healedAt !== undefined && b.healedAt >= 6000, `healed at ${String(b.healedAt)} ms`);
  leg("B: no dead-end text while it waits", b.deadEnds.length === 0, JSON.stringify(b.deadEnds));
  leg("B: no error row for a lost read", b.errorRows === 0, `error rows ${String(b.errorRows)}`);

  const c = await openProjectWhileLosing(await context.newPage(), { lossMs: 0, tap: true });
  leg("precondition C: the tapped project was not already open, and its first answer was lost", c.before !== TAPPED_PROJECT_ID && c.aborted === 1, `open before: ${String(c.before)}, aborted ${String(c.aborted)}, answered ${String(c.answered)}`);
  leg("C: the tapped project opens its workspace without input", c.healedAt !== undefined, `healed at ${String(c.healedAt)} ms`);
  leg("C: no dead-end text while it heals", c.deadEnds.length === 0, JSON.stringify(c.deadEnds));
  leg("C: no error row for a lost read", c.errorRows === 0, `error rows ${String(c.errorRows)}`);
} finally {
  await browser.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${String(results.length - failed)}/${String(results.length)} legs passed`);
process.exit(failed === 0 ? 0 : 1);
