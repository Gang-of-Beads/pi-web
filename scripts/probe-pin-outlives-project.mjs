import { chromium } from "@playwright/test";

/**
 * A pinned session outlives its project (B49; object model §1.14), 8505, phone 393x850 coarse.
 *
 * Owner, 2026-09-30: pins are global and keep working; opening one does not reopen its project;
 * closing a project says nothing about pins. Seen on 8505: closing a project that held a pinned
 * session left the pin stored and the row gone from PINNED without a word, because PINNED was
 * built from the open projects' lists.
 *
 * The probe pins a session of the `pi-web-reads-lane-probe` project (no other probe uses it),
 * closes the project, and then:
 * - PINNED still lists the session;
 * - tapping it opens the session, and the project stays closed;
 * - the page then names no project: the selection and the URL name the session alone (before, they
 *   kept the project the reader was in, or nothing a reload could open);
 * - a reload of that URL opens the session again;
 * - desktop 1440x900, standing in another project: opening it from the quick switcher leaves that
 *   project, so nothing goes on answering for it under the session, and the URL says so;
 * - desktop, standing in that project's session: going Back to a URL naming only a deleted session
 *   says it is gone, instead of keeping the previous session on screen under that URL.
 * Preconditions: the session exists, and it lives in that project's folder, so closing the project
 * really takes it off every open project's list. At the end it unpins the session and opens the
 * project again.
 */
const BASE = "http://127.0.0.1:8505";
const PROJECT_PATH = "/private/tmp/pi-web-reads-lane-probe";
const PROJECT_NAME = "pi-web-reads-lane-probe";
const SEED_PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const SEED_WORKSPACE = "ef2cdf93e1ac";
const SEED_SESSION = "01a05000-5eed-7c00-8000-0000000000e1";
const DELETED_SESSION = "deadbeef-0000-7000-8000-000000000000";
const SESSION = "01a0e979-281f-7247-8dbe-8e114fcc4366";
const SESSION_NAME = "Three Word Greeting";
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` (${detail})`}`);
};
const api = (path, init) => fetch(`${BASE}/api/machines/local${path}`, init);
const post = (path, body) => api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const projects = async () => (await api("/projects")).json();
const projectIdFor = async () => (await projects()).find((project) => project.path === PROJECT_PATH)?.id;

const browser = await chromium.launch();
let closed = false;
try {
  if (await projectIdFor() === undefined) await post("/projects", { path: PROJECT_PATH, name: PROJECT_NAME });
  const projectId = await projectIdFor();
  const exists = await api(`/sessions/${SESSION}/locate?cwd=${encodeURIComponent(PROJECT_PATH)}`);
  const located = exists.status === 200 ? await exists.json() : undefined;
  check("precondition: the project is open and the session lives in its folder", projectId !== undefined && located?.cwd === PROJECT_PATH, `project ${String(projectId)}, locate ${String(exists.status)}, cwd ${String(located?.cwd)}`);
  const pinned = await post("/session-pins", { sessionId: SESSION, pinned: true });
  const closing = await api(`/projects/${encodeURIComponent(String(projectId))}`, { method: "DELETE" });
  closed = closing.status === 200;
  check("precondition: the session is pinned and its project is closed", pinned.status === 200 && closed && await projectIdFor() === undefined, `pin ${String(pinned.status)}, close ${String(closing.status)}`);

  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  await page.goto(`${BASE}/?view=sessions`);
  await page.waitForTimeout(8_000);
  const pinnedRows = () => page.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    const input = app?.navigateInput?.();
    return input === undefined ? undefined : input.pinned.map((entry) => entry.session.id);
  });
  const listed = await pinnedRows();
  check("PINNED still lists the session of the closed project", Array.isArray(listed) && listed.includes(SESSION), JSON.stringify(listed));

  const row = page.locator("button.row.session", { hasText: SESSION_NAME }).first();
  const tappable = await row.count() > 0;
  if (tappable) await row.click({ timeout: 5000 });
  let opened = false;
  for (let waited = 0; waited < 8_000 && tappable; waited += 200) {
    const state = await page.evaluate(() => {
      const app = document.querySelector("pi-web-app");
      return { session: app?.state?.selectedSession?.id, rows: app?.state?.messages?.length ?? 0 };
    });
    if (state.session === SESSION && state.rows > 0) { opened = true; break; }
    await page.waitForTimeout(200);
  }
  check("tapping it opens the session", opened, tappable ? "" : "no row to tap");
  check("the project stays closed", await projectIdFor() === undefined, "");
  const readPlace = () => page.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    const url = new URL(window.location.href);
    return { project: app?.state?.selectedProject?.id, workspace: app?.state?.selectedWorkspace?.id, urlProject: url.searchParams.get("project"), urlWorkspace: url.searchParams.get("workspace"), urlSession: url.searchParams.get("session") };
  });
  let place = await readPlace();
  for (let waited = 0; waited < 3_000 && place.urlSession !== SESSION; waited += 100) {
    await page.waitForTimeout(100);
    place = await readPlace();
  }
  check("the page names the session alone: no project or workspace, in the state or the URL", place.project === undefined && place.workspace === undefined && place.urlProject === null && place.urlWorkspace === null && place.urlSession === SESSION, JSON.stringify(place));
  await page.reload();
  let reopened = false;
  for (let waited = 0; waited < 10_000; waited += 200) {
    const state = await page.evaluate(() => {
      const app = document.querySelector("pi-web-app");
      return { session: app?.state?.selectedSession?.id, rows: app?.state?.messages?.length ?? 0, project: app?.state?.selectedProject?.id };
    });
    if (state.session === SESSION && state.rows > 0 && state.project === undefined) { reopened = true; break; }
    await page.waitForTimeout(200);
  }
  check("a reload of that URL opens the session again, in no project", reopened, "");

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await desktop.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const wide = await desktop.newPage();
  await wide.goto(`${BASE}/?project=${SEED_PROJECT}&workspace=${SEED_WORKSPACE}&session=${SEED_SESSION}`);
  await wide.waitForTimeout(8_000);
  const before = await wide.evaluate(() => document.querySelector("pi-web-app")?.state?.selectedProject?.id);
  check("precondition: on desktop the reader stands in another project", before === SEED_PROJECT, String(before));
  await wide.evaluate(() => { document.querySelector("pi-web-app")?.openQuickSwitcher(); });
  await wide.waitForTimeout(3_000);
  const switcherRow = wide.locator("quick-switcher button.session-row", { hasText: SESSION_NAME }).first();
  const inSwitcher = await switcherRow.count() > 0;
  if (inSwitcher) await switcherRow.click({ timeout: 5000 });
  let left;
  for (let waited = 0; waited < 8_000 && inSwitcher; waited += 200) {
    const state = await wide.evaluate(() => {
      const app = document.querySelector("pi-web-app");
      const url = new URL(window.location.href);
      return { session: app?.state?.selectedSession?.id, project: app?.state?.selectedProject?.id, urlProject: url.searchParams.get("project") };
    });
    if (state.session === SESSION) left = state;
    if (left !== undefined && left.project === undefined && left.urlProject === null) break;
    await wide.waitForTimeout(200);
  }
  check("on desktop, opening it from the quick switcher leaves the project the reader stood in", left?.project === undefined && left?.urlProject === null && left?.session === SESSION, inSwitcher ? JSON.stringify(left) : "no row in the switcher");

  const deletedLocate = await api(`/sessions/${DELETED_SESSION}/locate?cwd=${encodeURIComponent("/")}`);
  check("precondition: the deleted-session fixture is gone on the machine", deletedLocate.status === 404, String(deletedLocate.status));
  await wide.goto(`${BASE}/?project=${SEED_PROJECT}&workspace=${SEED_WORKSPACE}&session=${SEED_SESSION}`);
  await wide.waitForTimeout(6_000);
  await wide.evaluate((id) => { window.history.pushState({}, "", `?session=${id}`); window.dispatchEvent(new PopStateEvent("popstate")); }, DELETED_SESSION);
  let said;
  for (let waited = 0; waited < 8_000; waited += 200) {
    said = await wide.evaluate(() => {
      const app = document.querySelector("pi-web-app");
      const notice = app?.shadowRoot?.querySelector(".session-target")?.textContent?.trim();
      return { selected: app?.state?.selectedSession?.id ?? null, project: app?.state?.selectedProject?.id ?? null, notice: notice ?? null };
    });
    if (said.notice?.includes("no longer exists") === true) break;
    await wide.waitForTimeout(200);
  }
  check("going to a URL naming only a deleted session says it is gone, and shows no other session", said?.notice?.includes("no longer exists") === true && said.selected === null && said.project === null, JSON.stringify(said));
  await desktop.close();
  await page.screenshot({ path: "/var/folders/2x/hqbz74zs7fvdxf_53693r26h0000gp/T/.playwright-mcp/b49a-pinned-closed-project-phone.png" });
} finally {
  await post("/session-pins", { sessionId: SESSION, pinned: false }).catch(() => undefined);
  if (closed || await projectIdFor() === undefined) await post("/projects", { path: PROJECT_PATH, name: PROJECT_NAME }).catch(() => undefined);
  await browser.close();
}
const failed = results.filter((result) => !result.pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
