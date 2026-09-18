import { chromium } from "playwright";

const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505/";

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true, colorScheme: "dark" })).newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("pi-web-app");
await page.waitForTimeout(3000);

const standalone = await page.evaluate(`(function(){
  const app = document.querySelector("pi-web-app");
  const page = app.shadowRoot.querySelector("app-navigate-page");
  const root = page?.shadowRoot;
  return {
    present: page !== null && page !== undefined,
    path: [...(root?.querySelectorAll(".path-step") ?? [])].map((node) => node.textContent.trim()),
    kinds: [...(root?.querySelectorAll(".kind") ?? [])].map((node) => node.textContent.trim()),
    sections: [...(root?.querySelectorAll(".section-title") ?? [])].map((node) => node.textContent.trim()),
    creates: [...(root?.querySelectorAll(".create") ?? [])].map((node) => node.textContent.trim()),
    closable: root?.querySelector(".close") !== null && root?.querySelector(".close") !== undefined,
  };
})()`);

if (!standalone.present) fail("without a session the phone does not land on the navigation page");
if (!standalone.path.includes("All projects")) fail(`the standalone page has no project level: ${JSON.stringify(standalone.path)}`);
if (!standalone.kinds.includes("Projects")) fail(`the standalone page cannot list projects: ${JSON.stringify(standalone.kinds)}`);
if (!standalone.kinds.includes("Sessions")) fail(`the standalone page cannot list sessions: ${JSON.stringify(standalone.kinds)}`);
if (!standalone.creates.some((label) => label.includes("New session"))) fail("the standalone page cannot start a session");
if (standalone.closable) fail("the standalone page offers a close, but there is nothing behind it");

const opened = await page.evaluate(`(async function(){
  const app = document.querySelector("pi-web-app");
  const project = Reflect.get(app, "state").projects.find((entry) => entry.name === "pi-web-8505-seed-workspace");
  if (project === undefined) throw new Error("seed project missing");
  await Reflect.get(app, "workspaces").selectProject(project);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const session = (Reflect.get(app, "state").sessions ?? [])[0];
  if (session === undefined) throw new Error("seed session missing");
  await app.selectNavigationItem("sessions", "chat", () => Reflect.get(app, "sessions").selectSession(session));
  await new Promise((resolve) => setTimeout(resolve, 2500));
  return { view: app.displayMainView(), session: Reflect.get(app, "state").selectedSession?.id };
})()`);
if (opened.view !== "chat") fail(`expected the chat view before opening navigation, saw ${opened.view}`);

await page.evaluate(`(function(){
  const app = document.querySelector("pi-web-app");
  const bar = app.shadowRoot.querySelector("app-context-bar").shadowRoot;
  const key = bar.querySelector("button[aria-label='Open navigation']");
  if (key === null) throw new Error("no navigation key in the chat bar");
  key.click();
})()`);
await page.waitForTimeout(1000);

const overlay = await page.evaluate(`(function(){
  const app = document.querySelector("pi-web-app");
  const root = app.shadowRoot.querySelector(".navigate-overlay app-navigate-page")?.shadowRoot;
  return {
    open: root !== null && root !== undefined,
    closable: root?.querySelector(".close") !== null && root?.querySelector(".close") !== undefined,
    path: [...(root?.querySelectorAll(".path-step") ?? [])].map((node) => node.textContent.trim()),
    kinds: [...(root?.querySelectorAll(".kind") ?? [])].map((node) => node.textContent.trim()),
    sections: [...(root?.querySelectorAll(".section-title") ?? [])].map((node) => node.textContent.trim()),
    rows: [...(root?.querySelectorAll(".row.session .row-title") ?? [])].map((node) => node.textContent.trim()),
    sheets: app.shadowRoot.querySelector("context-switcher-sheet") !== null,
  };
})()`);

if (!overlay.open) fail("the menu key did not open the navigation page over the session");
if (!overlay.closable) fail("the navigation page over a session offers no way back to it");
if (overlay.sheets) fail("the retired projects sheet opened as well");
if (overlay.path.length === 0) fail("the navigation page shows no context path");
if (!overlay.kinds.includes("Folders")) fail(`standing in a folder the page cannot list its siblings: ${JSON.stringify(overlay.kinds)}`);
if (overlay.rows.length === 0) fail("the navigation page lists no sessions in scope");
if (overlay.rows.some((title) => /^[0-9a-f]{8}-/u.test(title))) fail(`sessions are listed by id rather than name: ${JSON.stringify(overlay.rows)}`);

const tagged = await page.evaluate(`(async function(){
  const app = document.querySelector("pi-web-app");
  const root = app.shadowRoot.querySelector(".navigate-overlay app-navigate-page").shadowRoot;
  const search = root.querySelector(".search");
  search.value = "#nothing-matches-this";
  search.dispatchEvent(new Event("input"));
  await new Promise((resolve) => setTimeout(resolve, 300));
  const empty = root.textContent.includes("No sessions match");
  search.value = "";
  search.dispatchEvent(new Event("input"));
  await new Promise((resolve) => setTimeout(resolve, 300));
  return { empty, restored: root.querySelectorAll(".row.session").length };
})()`);
if (!tagged.empty) fail("a tag that matches nothing does not say so");
if (tagged.restored === 0) fail("clearing the search did not bring the sessions back");

await page.screenshot({ path: "/tmp/journeys/navigate.png" });

await page.evaluate(`(function(){
  const app = document.querySelector("pi-web-app");
  app.shadowRoot.querySelector(".navigate-overlay app-navigate-page").shadowRoot.querySelector(".close").click();
})()`);
await page.waitForTimeout(700);

const closed = await page.evaluate(`(function(){
  const app = document.querySelector("pi-web-app");
  return {
    overlay: app.shadowRoot.querySelector(".navigate-overlay") !== null,
    view: app.displayMainView(),
    session: Reflect.get(app, "state").selectedSession?.id,
  };
})()`);
if (closed.overlay) fail("the navigation page did not close");
if (closed.view !== "chat" || closed.session !== opened.session) fail(`closing navigation did not return to the session: ${JSON.stringify(closed)}`);

await browser.close();
if (process.exitCode === 1) process.exit(1);
console.log("PASS: navigation is one page - standalone without a session, over the session with a way back, path and tags included");
