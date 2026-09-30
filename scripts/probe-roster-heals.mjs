import { chromium } from "@playwright/test";

/**
 * The machines roster heals by itself (B48, object model §1.1, P1 slice 3).
 *
 * Before: a roster read without an answer set machinesLoad "failed" and
 * painted "Lost connection to PI WEB. Reconnecting…". Nothing read the roster
 * again on a local route, so the machine list stayed missing. A remote deep
 * link retried five times, then said "is still unavailable." and dropped the
 * restore.
 *
 * Now the roster is read again by itself and no banner claims a lost read.
 * The app row says "Reconnecting…" once if the roster stays unanswered past
 * the grace, and a remote deep link waits for the roster, keeping its URL,
 * while it is still what the reader wants.
 *
 * Phone 393x850, coarse pointer. The browser loses every GET /api/machines for
 * 5 s from the first one:
 * - A: a local route; the roster heals without input, with no banner. (The
 *   old build never read the roster again here, so only one answer was lost.)
 * - B: a deep link to a remote machine; the link keeps its machine, the
 *   machine is selected once the roster answers, and no banner shows. The
 *   remote's own reads are blocked, so its health claim ("is unavailable;
 *   reconnecting…") is expected and allowed. "still unavailable" is not.
 *   It heals within 10 s; the old ladder (1, 3, 8 s) took about 12 s. The
 *   old fifth-try give-up takes about a minute to reach, so a unit test
 *   pins that one (PiWebApp.bootRestore.test.ts).
 */
const BASE = process.env.PI_WEB_PROBE_BASE ?? process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const PROJECT_ID = process.env.PROBE_PROJECT_ID ?? "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const REMOTE_ID = process.env.PROBE_REMOTE_ID ?? "prod-8504-waveb";
const LOSS_MS = 5000;
const HEAL_BOUND_MS = 10_000;
const DEAD_ENDS = ["Lost connection to PI WEB", "Connection problem", "still unavailable", "A request timed out"];
const ROSTER_READ = /\/api\/machines$/u;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
function leg(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` - ${detail}`}`);
}

async function bootWhileRosterIsLost(page, search, expectedMachineId) {
  let aborted = 0;
  let answered = 0;
  let lossUntil;
  await page.route(ROSTER_READ, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    lossUntil ??= Date.now() + LOSS_MS;
    if (Date.now() < lossUntil) {
      aborted += 1;
      return route.abort("connectionreset");
    }
    answered += 1;
    return route.continue();
  });
  await page.goto(`${BASE}/${search}`, { waitUntil: "domcontentloaded" });
  const deadEnds = new Set();
  let rowMounts = 0;
  let rowShown = false;
  let healedAt;
  let urlKeptMachine = true;
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    const seen = await page.evaluate(() => {
      const deepText = (node) => [...node.childNodes].map((child) => (child.nodeType === Node.TEXT_NODE ? child.textContent : deepText(child))).join(" ") + (node.shadowRoot ? deepText(node.shadowRoot) : "");
      const state = document.querySelector("pi-web-app")?.state;
      return { text: deepText(document.body).replace(/\s+/gu, " "), machines: state?.machines?.length ?? 0, machinesLoad: state?.machinesLoad, selected: state?.selectedMachine?.id, url: location.search };
    });
    for (const deadEnd of DEAD_ENDS) if (seen.text.includes(deadEnd)) deadEnds.add(deadEnd);
    const showing = seen.text.includes("Reconnecting…") && !seen.text.includes("is unavailable; reconnecting");
    if (showing && !rowShown) rowMounts += 1;
    rowShown = showing;
    if (expectedMachineId !== "local" && !seen.url.includes(`machine=${expectedMachineId}`)) urlKeptMachine = false;
    if (healedAt === undefined && seen.machinesLoad === "loaded" && seen.machines > 1 && seen.selected === expectedMachineId) healedAt = Date.now() - started;
    if (healedAt !== undefined && Date.now() - started > healedAt + 2500) break;
    await sleep(200);
  }
  await page.unroute(ROSTER_READ);
  return { aborted, answered, deadEnds: [...deadEnds], rowMounts, healedAt, urlKeptMachine };
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(new RegExp(`/api/machines/${REMOTE_ID}/`, "u"), (route) => route.abort("blockedbyclient"));

  const a = await bootWhileRosterIsLost(await context.newPage(), `?machine=local&project=${PROJECT_ID}`, "local");
  leg("precondition A: the first roster answer was lost", a.aborted >= 1, `aborted ${String(a.aborted)}, answered ${String(a.answered)}`);
  leg("A: the roster heals without input", a.healedAt !== undefined, `healed at ${String(a.healedAt)} ms`);
  leg("A: no banner claims the lost read", a.deadEnds.length === 0, JSON.stringify(a.deadEnds));
  leg("A: the row says Reconnecting at most once", a.rowMounts <= 1, `row mounts ${String(a.rowMounts)}`);

  const b = await bootWhileRosterIsLost(await context.newPage(), `?machine=${REMOTE_ID}&project=${PROJECT_ID}`, REMOTE_ID);
  leg("precondition B: roster answers were lost for 5 s", b.aborted >= 2, `aborted ${String(b.aborted)}, answered ${String(b.answered)}`);
  leg("B: the deep link keeps its machine, before and after the roster answers", b.urlKeptMachine);
  leg("B: the remote machine is selected once the roster answers", b.healedAt !== undefined, `healed at ${String(b.healedAt)} ms`);
  leg("B: it heals within 10 s: the shared backoff, not the old 1, 3, 8 s ladder", b.healedAt !== undefined && b.healedAt <= HEAL_BOUND_MS, `healed at ${String(b.healedAt)} ms`);
  leg("B: no banner claims the lost read, and nothing says it gave up", b.deadEnds.length === 0, JSON.stringify(b.deadEnds));
  leg("B: the row says Reconnecting at most once", b.rowMounts <= 1, `row mounts ${String(b.rowMounts)}`);
} finally {
  await browser.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${String(results.length - failed)}/${String(results.length)} legs passed`);
process.exit(failed === 0 ? 0 : 1);
