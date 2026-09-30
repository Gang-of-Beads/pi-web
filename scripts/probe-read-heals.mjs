import { chromium } from "@playwright/test";

/**
 * A read that got no answer heals by itself (B48, object model §0 and §2.3).
 *
 * Owner, 2026-09-30, from the phone board on 8504: "Couldn't read the projects
 * on this machine." stayed on screen after one lost answer, while the server
 * had answered in under 10 ms. The fix: a projects read that goes unanswered
 * is retried on its own; nothing on the board claims a failure or an empty
 * list meanwhile; the app's one row says "Reconnecting…" only if the machine
 * stays unanswered past the grace, and leaves when an answer comes.
 *
 * Two legs on the phone board (393x850, coarse pointer), with the projects
 * read intercepted in the browser:
 * - A: the first answer is lost. The board heals without input, never shows a
 *   dead-end text, and the row never appears (the retry lands inside the grace).
 * - B: every answer is lost for 7 s. The row appears once, no dead-end text
 *   shows, and the board heals when answers flow again.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const PROJECT_NAME = "pi-web-8505-seed-workspace";
const DEAD_ENDS = ["Couldn't read the projects", "Projects could not be loaded", "No projects yet", "Nothing to choose at this level.", "Loading projects…", "Could not load projects"];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
function leg(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` - ${detail}`}`);
}

async function watchBoard(page, { lossMs }) {
  let aborted = 0;
  let answered = 0;
  const lossUntil = Date.now() + lossMs;
  let firstOnly = lossMs === 0;
  await page.route(/\/api\/machines\/local\/projects$/u, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    if (firstOnly || Date.now() < lossUntil) {
      firstOnly = false;
      aborted += 1;
      return route.abort("connectionreset");
    }
    answered += 1;
    return route.continue();
  });
  await page.goto(`${BASE}/?view=sessions`, { waitUntil: "domcontentloaded" });
  const projectsTab = page.locator("nav.kinds button:visible", { hasText: /^\s*Projects\s*$/u }).first();
  await projectsTab.click({ timeout: 10_000 });
  const projectRow = page.locator("button.row:visible", { hasText: PROJECT_NAME });
  const deadEnds = new Set();
  let rowMounts = 0;
  let rowShown = false;
  let healedAt;
  const started = Date.now();
  while (Date.now() - started < 25_000) {
    const text = await page.evaluate(() => {
      const deepText = (node) => [...node.childNodes].map((child) => (child.nodeType === Node.TEXT_NODE ? child.textContent : deepText(child))).join(" ") + (node.shadowRoot ? deepText(node.shadowRoot) : "");
      return deepText(document.body).replace(/\s+/gu, " ");
    });
    for (const deadEnd of DEAD_ENDS) if (text.includes(deadEnd)) deadEnds.add(deadEnd);
    const showing = text.includes("Reconnecting…");
    if (showing && !rowShown) rowMounts += 1;
    rowShown = showing;
    if (healedAt === undefined && await projectRow.count() > 0) healedAt = Date.now() - started;
    if (healedAt !== undefined && !showing && Date.now() - started > healedAt + 2500) break;
    await sleep(200);
  }
  await page.unroute(/\/api\/machines\/local\/projects$/u);
  return { aborted, answered, deadEnds: [...deadEnds], rowMounts, healedAt, rowStillShown: rowShown };
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });

  const a = await watchBoard(await context.newPage(), { lossMs: 0 });
  leg("precondition A: the first projects answer was lost", a.aborted === 1, `aborted ${String(a.aborted)}, answered ${String(a.answered)}`);
  leg("A: the board heals without input", a.healedAt !== undefined, `healed at ${String(a.healedAt)} ms`);
  leg("A: no dead-end text while it heals", a.deadEnds.length === 0, JSON.stringify(a.deadEnds));
  leg("A: the row stays quiet for a loss the retry recovers inside the grace", a.rowMounts === 0, `row mounts ${String(a.rowMounts)}`);

  const b = await watchBoard(await context.newPage(), { lossMs: 7000 });
  leg("precondition B: answers were lost for 7 s", b.aborted >= 2, `aborted ${String(b.aborted)}, answered ${String(b.answered)}`);
  leg("B: the row says Reconnecting once, without flicker", b.rowMounts === 1, `row mounts ${String(b.rowMounts)}`);
  leg("B: no dead-end text while it reconnects", b.deadEnds.length === 0, JSON.stringify(b.deadEnds));
  leg("B: the board heals when answers flow, and the row leaves", b.healedAt !== undefined && !b.rowStillShown, `healed at ${String(b.healedAt)} ms, row still shown ${String(b.rowStillShown)}`);
} finally {
  await browser.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${String(results.length - failed)}/${String(results.length)} legs passed`);
process.exit(failed === 0 ? 0 : 1);
