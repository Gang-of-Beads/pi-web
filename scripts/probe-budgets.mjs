import { chromium } from "@playwright/test";

/**
 * The network budgets of object-model §4.3, measured in one run on 8505, phone 393x850.
 *
 * Each leg is a budget from that table; a regression fails it, so the table cannot drift into prose.
 * Legs:
 * - warm open: a reload of a deep link to the small seed session draws its first transcript row
 *   within 400 ms of navigation (the session was opened once before, so daemon and file are warm);
 * - boot reads: the local machine gets at most 24 `/api` requests in the first 15 s of that boot,
 *   background included (the remote machine is blocked and not counted). 24 is what the boot asks
 *   for on 2026-10-01; the ceiling stops a new boot read from landing without a decision. The P7
 *   target is 8, through composite reads (P7 slices b-d), each worth at most one round trip under
 *   HTTP/2, which production speaks (object-model §4.3, §4.7);
 * - idle: with the git panel on screen, 60 s of quiet costs at most 8 local `/api` requests plus
 *   4 head checks, and no pins read.
 * The cold open (first row within 1.5 s on the 17.8 MB seed, daemon just restarted) needs a
 * daemon restart and stays in probe-open-latency.mjs.
 */
const BASE = process.env.PI_WEB_PROBE_BASE ?? "http://127.0.0.1:8505";
const ROUTE = "project=991606fd-e498-4b93-a1ce-2af09efdb0e7&workspace=ef2cdf93e1ac";
const SESSION = "01a05000-5eed-7c00-8000-0000000000e1";
const LINK = `${BASE}/?${ROUTE}&session=${SESSION}`;
const GIT_LINK = `${LINK}&tool=${encodeURIComponent("git:workspace.git")}&view=${encodeURIComponent("git:workspace.git")}`;
const WARM_ROW_MS = 400;
const BOOT_API = 24;
const IDLE_API_PER_MIN = 8 + 4;
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` (${detail})`}`);
};
const localApi = (url) => {
  const path = new URL(url).pathname;
  return path.startsWith("/api/") && !path.startsWith("/api/machines/prod-8504-waveb/") ? path : undefined;
};
const shape = (path) => path
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu, ":id")
  .replace(/\/workspaces\/[0-9a-f]{12}/gu, "/workspaces/:w");
const tally = (paths) => {
  const counts = {};
  for (const path of paths) counts[shape(path)] = (counts[shape(path)] ?? 0) + 1;
  return Object.entries(counts).sort((left, right) => right[1] - left[1]).map(([path, count]) => `${String(count)} ${path}`).join(", ");
};

const firstRow = (page) => page.evaluate(async (sessionId) => {
  const deep = (root) => [...root.querySelectorAll("*")].some((element) => element.matches("chat-view") && element.shadowRoot?.querySelector("article.msg") !== null)
    || [...root.querySelectorAll("*")].some((element) => element.shadowRoot !== null && element.shadowRoot !== undefined && deep(element.shadowRoot));
  const started = performance.now();
  while (performance.now() - started < 15_000) {
    const state = document.querySelector("pi-web-app")?.state;
    if (state?.selectedSession?.id === sessionId && deep(document)) return Math.round(performance.now());
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  return undefined;
}, SESSION);

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  await page.goto(LINK);
  const warmedRow = await firstRow(page);
  check("precondition: the seed session opened and drew a row", warmedRow !== undefined, `${String(warmedRow)} ms`);

  const bootReads = [];
  const onBoot = (request) => { const path = localApi(request.url()); if (path !== undefined) bootReads.push(path); };
  page.on("request", onBoot);
  await page.goto(LINK, { waitUntil: "commit" });
  const warmRow = await firstRow(page);
  check(`warm open: the first row within ${String(WARM_ROW_MS)} ms`, warmRow !== undefined && warmRow <= WARM_ROW_MS, `${String(warmRow)} ms`);
  await page.waitForTimeout(15_000);
  page.off("request", onBoot);
  check(`boot reads: at most ${String(BOOT_API)} local /api requests in 15 s`, bootReads.length <= BOOT_API, `${String(bootReads.length)}: ${tally(bootReads)}`);

  await page.goto(GIT_LINK);
  await page.waitForTimeout(10_000);
  const gitShown = await page.evaluate(() => {
    const find = (root) => root.querySelector("section.git-panel") ?? [...root.querySelectorAll("*")].map((element) => element.shadowRoot).filter((shadow) => shadow !== null && shadow !== undefined).map(find).find((hit) => hit !== null) ?? null;
    return find(document)?.checkVisibility() === true;
  });
  check("precondition: the git panel is on screen", gitShown);
  const idleReads = [];
  const onIdle = (request) => { const path = localApi(request.url()); if (path !== undefined) idleReads.push(path); };
  page.on("request", onIdle);
  await page.waitForTimeout(60_000);
  page.off("request", onIdle);
  const pinsIdle = idleReads.filter((path) => path.endsWith("/session-pins")).length;
  check(`idle: at most ${String(IDLE_API_PER_MIN)} local /api requests in 60 s with the git panel on screen`, idleReads.length <= IDLE_API_PER_MIN, `${String(idleReads.length)}: ${tally(idleReads)}`);
  check("idle: no pins read", pinsIdle === 0, `${String(pinsIdle)} reads`);
} finally {
  await browser.close();
}
const failed = results.filter((result) => !result.pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
