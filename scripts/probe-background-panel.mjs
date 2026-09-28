/**
 * Background runs have a readable home in the ≡ menu, owned by their plugin.
 *
 * The owner: "三个横杠下来也可以看具体的细节，每个插件可以自己加自己的列表/显示". The first list
 * the plugin drew read "Install pi-web .26 when publishedlost" - name and status run together
 * - over the transcript. The background-tasks answer is served at the network layer so the
 * real poll -> state -> plugin panel path runs; the probe opens the ≡ "Go to a view" sheet,
 * taps Background and checks the plugin's own element: running first, name and status apart,
 * a long history cut with the remainder counted, and nothing drawn above the composer. Then
 * the read fails (the rows stay, marked stale) and the session changes (the view stays
 * Background and says what it knows about the new session instead of turning into Files).
 * Reads run on selection, on the daemon's count signal and on the tab becoming visible -
 * there is no timer - so the failed read is triggered through the visibility path. The list
 * host is display: contents; its .viewer is what takes space and is what gets measured.
 */
import { chromium } from "playwright";
import { PROBE_BASE, openProbedSession } from "./probeSession.mjs";

const fails = [];
const fail = (message) => { fails.push(message); console.log("FAIL", message); };

const now = Date.now();
const iso = (offsetMs) => new Date(now - offsetMs).toISOString();
const tasks = [
  { id: "live", name: "Build and probe", command: "npm run build", status: "running", startedAt: iso(60_000), durationMs: 60_000, bytesWritten: 10, hasOutput: true },
  ...Array.from({ length: 40 }, (_, index) => ({ id: `done-${String(index)}`, name: `Install pi-web .${String(index)} when published`, command: "true", status: index === 0 ? "failed" : "completed", startedAt: iso(120_000 + index * 60_000), durationMs: 5_000, exitCode: index === 0 ? 1 : 0, bytesWritten: 0, hasOutput: false })),
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
await page.route("**/background-tasks*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tasks }) }));
try {
  await openProbedSession(page, PROBE_BASE);
  await page.waitForTimeout(3000);
  const inState = await page.evaluate(async () => {
    for (let waited = 0; waited < 20_000; waited += 500) {
      const count = document.querySelector("pi-web-app")?.state?.backgroundTasks?.length ?? 0;
      if (count > 0) return count;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return 0;
  });
  if (inState === 0) throw new Error("precondition: the served background tasks never reached the app state");

  const panel = await page.evaluate(async () => {
    const app = document.querySelector("pi-web-app");
    const registry = Reflect.get(app, "plugins");
    const panels = Reflect.apply(Reflect.get(registry, "getWorkspacePanels"), registry, []);
    const background = panels.find((entry) => String(entry.id).endsWith("workspace.background"));
    if (background === undefined) return { error: `no background panel among ${panels.map((entry) => entry.id).join(", ")}` };
    Reflect.apply(Reflect.get(app, "toggleGoToSheet"), app, []);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const sheet = app.shadowRoot.querySelector("app-go-to-sheet");
    const destinations = (sheet?.destinations ?? []).map((entry) => entry.label);
    const boardListsIt = destinations.includes("Background");
    const button = [...(sheet?.shadowRoot?.querySelectorAll("button") ?? [])].find((node) => (node.textContent ?? "").includes("Background"));
    button?.click();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    if (button === undefined) return { error: `the ≡ sheet offers no Background entry to tap: ${destinations.join(", ")}`, boardListsIt };
    const findDeep = (root, tag) => {
      for (const node of root.querySelectorAll("*")) {
        if (node.tagName === tag) return node;
        if (node.shadowRoot) {
          const inner = findDeep(node.shadowRoot, tag);
          if (inner) return inner;
        }
      }
      return null;
    };
    const list = findDeep(document, "PI-WEB-BACKGROUND-TASKS");
    if (list === null) return { error: "the Background panel did not render the plugin's list", boardListsIt, mainView: app.state.mainView };
    await list.updateComplete;
    const rows = [...list.shadowRoot.querySelectorAll(".task")];
    const viewer = list.shadowRoot.querySelector(".viewer");
    const viewerRect = viewer?.getBoundingClientRect();
    const firstRect = rows[0]?.getBoundingClientRect();
    const lastStatusRect = rows[0]?.querySelector(".status")?.getBoundingClientRect();
    const first = rows[0];
    const nameRect = first?.querySelector(".name")?.getBoundingClientRect();
    const statusRect = first?.querySelector(".status")?.getBoundingClientRect();
    return {
      boardListsIt,
      mainView: app.state.mainView,
      rows: rows.length,
      firstName: first?.querySelector(".name")?.textContent ?? null,
      firstStatus: first?.querySelector(".status")?.textContent ?? null,
      nameAndStatusApart: nameRect !== undefined && statusRect !== undefined && statusRect.left >= nameRect.right,
      failedTone: list.shadowRoot.querySelector(".task.problem .status")?.textContent ?? null,
      more: list.shadowRoot.querySelector(".more")?.textContent ?? null,
      rowLeft: firstRect === undefined ? null : Math.round(firstRect.left),
      statusRight: lastStatusRect === undefined ? null : Math.round(lastStatusRect.right),
      viewport: window.innerWidth,
      scrolls: viewer === null ? null : getComputedStyle(viewer).overflowY === "auto" && viewer.scrollHeight > viewer.clientHeight,
      viewerBottom: viewerRect === undefined ? null : Math.round(viewerRect.bottom),
      viewportHeight: window.innerHeight,
    };
  });
  await page.screenshot({ path: "/tmp/background-panel.png" });
  console.log("panel:", JSON.stringify(panel));
  if (panel.error !== undefined) fail(panel.error);
  else {
    if (!panel.boardListsIt) fail("the ≡ sheet does not list Background");
    if (panel.firstName !== "Build and probe" || panel.firstStatus !== "running") fail(`running work is not first: ${String(panel.firstName)} / ${String(panel.firstStatus)}`);
    if (!panel.nameAndStatusApart) fail("name and status are not laid out apart");
    if (panel.failedTone !== "failed") fail(`a failed run is not marked failed: ${String(panel.failedTone)}`);
    if (panel.rows !== 31) fail(`expected 1 running + 30 finished rows, got ${String(panel.rows)}`);
    if (panel.more === null || !panel.more.includes("10 older runs")) fail(`the cut history is not counted: ${String(panel.more)}`);
    if (panel.rowLeft === null || panel.rowLeft < 8) fail(`the list sits on the screen edge (row left ${String(panel.rowLeft)})`);
    if (panel.statusRight === null || panel.statusRight > panel.viewport - 8) fail(`the status touches the right screen edge (${String(panel.statusRight)} of ${String(panel.viewport)})`);
    if (panel.scrolls !== true) fail("the long list does not scroll inside its panel");
    if (panel.viewerBottom !== null && panel.viewerBottom > panel.viewportHeight) fail(`the list runs past the bottom of the screen (${String(panel.viewerBottom)} > ${String(panel.viewportHeight)})`);
  }

  await page.unroute("**/background-tasks*");
  await page.route("**/background-tasks*", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "probe: read failed" }) }));
  const failedRead = await page.evaluate(async () => {
    const app = document.querySelector("pi-web-app");
    document.dispatchEvent(new Event("visibilitychange"));
    for (let waited = 0; waited < 15_000; waited += 500) {
      if (app?.state?.backgroundTasksRead === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const findDeep = (root, tag) => {
      for (const node of root.querySelectorAll("*")) {
        if (node.tagName === tag) return node;
        if (node.shadowRoot) { const inner = findDeep(node.shadowRoot, tag); if (inner) return inner; }
      }
      return null;
    };
    const list = findDeep(document, "PI-WEB-BACKGROUND-TASKS");
    await list?.updateComplete;
    return { read: app?.state?.backgroundTasksRead, note: list?.shadowRoot?.querySelector(".note")?.textContent ?? null, rows: list?.shadowRoot?.querySelectorAll(".task").length ?? 0 };
  });
  console.log("failed read:", JSON.stringify(failedRead));
  if (failedRead.read !== "failed") fail(`precondition: the failed read never reached the app (read=${String(failedRead.read)})`);
  else {
    if (failedRead.note !== "Could not refresh - showing the last read.") fail(`a failed refresh is not said: ${String(failedRead.note)}`);
    if (failedRead.rows !== 31) fail(`the last read rows were dropped on a failed refresh (${String(failedRead.rows)})`);
  }

  const switched = await page.evaluate(async () => {
    const app = document.querySelector("pi-web-app");
    const current = app.state.selectedSession?.id;
    const other = (app.state.sessions ?? []).find((session) => session.id !== current && session.archived !== true);
    if (other === undefined) return { error: "precondition: no second session to switch to" };
    await app.sessions.selectSession(other);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const findDeep = (root, tag) => {
      for (const node of root.querySelectorAll("*")) {
        if (node.tagName === tag) return node;
        if (node.shadowRoot) { const inner = findDeep(node.shadowRoot, tag); if (inner) return inner; }
      }
      return null;
    };
    const list = findDeep(document, "PI-WEB-BACKGROUND-TASKS");
    await list?.updateComplete;
    const sheetDestinations = (() => {
      Reflect.apply(Reflect.get(app, "toggleGoToSheet"), app, []);
      return null;
    })();
    await new Promise((resolve) => setTimeout(resolve, 800));
    const sheet = app.shadowRoot.querySelector("app-go-to-sheet");
    const selected = (sheet?.destinations ?? []).find((entry) => entry.selected === true)?.label ?? null;
    Reflect.apply(Reflect.get(app, "toggleGoToSheet"), app, []);
    const viewer = list?.shadowRoot?.querySelector(".viewer");
    return { sheetDestinations, mainView: app.state.mainView, read: app.state.backgroundTasksRead, listShown: viewer !== null && viewer !== undefined && viewer.getBoundingClientRect().width > 0, note: list?.shadowRoot?.querySelector(".note")?.textContent ?? null, selected };
  });
  console.log("after switching session:", JSON.stringify(switched));
  if (switched.error !== undefined) fail(switched.error);
  else {
    if (!switched.listShown) fail(`switching session replaced the Background view (mainView ${String(switched.mainView)})`);
    if (switched.selected !== "Background") fail(`the ≡ sheet marks ${String(switched.selected)} as current, not Background`);
    if (switched.read === "failed" && switched.note !== "This machine could not read the background runs.") fail(`the switched session's failed read is not said: ${String(switched.note)}`);
    if (switched.read !== "failed" && switched.note === null) fail("the switched session's list says nothing about its read state");
  }
} catch (error) {
  fail(String(error));
} finally {
  await browser.close();
}
console.log(fails.length === 0 ? "PASS background-panel" : `FAIL background-panel (${String(fails.length)})`);
process.exit(fails.length === 0 ? 0 : 1);
