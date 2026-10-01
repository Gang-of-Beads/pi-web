import { chromium } from "@playwright/test";

/**
 * The board is one read (state-diagram D5; P4 slice a), 8505, phone 393x850 coarse.
 *
 * The page used to read a machine's board itself: each project's workspaces and each workspace's
 * sessions, 1 + P + W requests. It now asks the machine's web process once.
 * - the page shows the board with no per-source board reads, and one `session-board`;
 * - control: the board the page holds lists the same sessions as the per-workspace listings
 *   read directly, and every source answered.
 */
const BASE = "http://127.0.0.1:8505";
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` (${detail})`}`);
};
const json = async (path) => (await fetch(`${BASE}${path}`)).json();

const browser = await chromium.launch();
try {
  const projects = await json("/api/machines/local/projects");
  const resolutions = await Promise.all(projects.map((project) => json(`/api/machines/local/projects/${encodeURIComponent(project.id)}/workspaces`).catch(() => ({ workspaces: [] }))));
  const paths = [...new Set(resolutions.flatMap((resolution) => (resolution.workspaces ?? []).map((workspace) => workspace.path)))];
  const listings = await Promise.all(paths.map((path) => json(`/api/machines/local/sessions?cwd=${encodeURIComponent(path)}`)));
  const direct = [...new Set(listings.flat().map((session) => session.id))].sort();
  check("precondition: the machine has projects, workspaces and sessions", projects.length > 1 && paths.length > 1 && direct.length > 0, `${String(projects.length)} projects, ${String(paths.length)} workspaces, ${String(direct.length)} sessions`);

  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  const reads = { board: 0, workspaces: 0, listings: 0 };
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/machines/local/")) return;
    if (path.endsWith("/session-board")) reads.board += 1;
    else if (/\/projects\/[^/]+\/workspaces$/u.test(path)) reads.workspaces += 1;
    else if (path.endsWith("/sessions")) reads.listings += 1;
  });
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(10_000);
  const shown = await page.evaluate(() => {
    const board = document.querySelector("pi-web-app")?.sessionBoards?.board("local");
    return board === undefined ? undefined : { ids: board.sessions.map((session) => session.id), unknown: board.unknownSources.length };
  });
  check("precondition: the page holds the local machine's board", shown !== undefined, "");
  check("precondition: every source of the board answered", shown?.unknown === 0, `${String(shown?.unknown)} unknown`);
  check("the board is one read, and the page reads no listing and at most the selected project's workspaces", reads.board === 1 && reads.listings === 0 && reads.workspaces <= 1, JSON.stringify(reads));
  const held = [...new Set(shown?.ids ?? [])].sort();
  check("control: the board lists what the per-workspace listings list", JSON.stringify(held) === JSON.stringify(direct), `${String(held.length)} held, ${String(direct.length)} listed directly`);
  await page.screenshot({ path: "/var/folders/2x/hqbz74zs7fvdxf_53693r26h0000gp/T/.playwright-mcp/p4a-board-phone.png" });
} finally {
  await browser.close();
}
const failed = results.filter((result) => !result.pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
