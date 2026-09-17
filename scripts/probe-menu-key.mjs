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

await page.evaluate(`(async function(){
  const app = document.querySelector("pi-web-app");
  const project = Reflect.get(app, "state").projects.find((entry) => entry.name === "pi-web-8505-seed-workspace");
  if (project === undefined) throw new Error("seed project missing");
  await Reflect.get(app, "workspaces").selectProject(project);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const session = (Reflect.get(app, "state").sessions ?? [])[0];
  if (session === undefined) throw new Error("seed session missing");
  await app.selectNavigationItem("sessions", "chat", () => Reflect.get(app, "sessions").selectSession(session));
  await new Promise((resolve) => setTimeout(resolve, 3000));
})()`);

const before = await page.evaluate(`(function(){
  const app = document.querySelector("pi-web-app");
  const bar = app.shadowRoot.querySelector("app-context-bar");
  const toggle = bar.shadowRoot.querySelector(".panel-toggle");
  return {
    view: app.displayMainView(),
    session: Reflect.get(app, "state").selectedSession?.id,
    toggleLabel: toggle?.getAttribute("aria-label") ?? null,
    titleIsButton: bar.shadowRoot.querySelector(".session-title")?.tagName ?? null,
  };
})()`);

if (before.session === undefined) fail("probe did not open a session");
if (before.view !== "chat") fail(`expected the chat view before the tap, saw ${before.view}`);
if (before.toggleLabel !== "Open session menu") fail(`the menu key still promises "${before.toggleLabel ?? "nothing"}"`);
if (before.titleIsButton !== "SPAN") fail(`the bar title is still a ${before.titleIsButton ?? "missing element"}, not an inert label`);

await page.evaluate(`(function(){
  const app = document.querySelector("pi-web-app");
  app.shadowRoot.querySelector("app-context-bar").shadowRoot.querySelector(".panel-toggle").click();
})()`);
await page.waitForTimeout(1200);

const opened = await page.evaluate(`(function(){
  const app = document.querySelector("pi-web-app");
  const switcher = app.shadowRoot.querySelector("quick-switcher");
  const text = switcher?.shadowRoot?.textContent ?? "";
  return {
    view: app.displayMainView(),
    session: Reflect.get(app, "state").selectedSession?.id,
    switcher: switcher !== null,
    contextSheet: app.shadowRoot.querySelector("context-switcher-sheet") !== null,
    hasBrowse: text.includes("Browse machines and projects"),
    hasSettings: text.includes("Settings"),
    hasNewSession: text.includes("New session"),
  };
})()`);

if (!opened.switcher) fail("the menu key did not open the quick-access menu");
if (opened.contextSheet) fail("the menu key still opens the projects sheet");
if (opened.view !== "chat" || opened.session !== before.session) fail("the menu key navigated away from the open session");
if (!opened.hasBrowse) fail("the menu lost its machines-and-projects entry");
if (!opened.hasSettings) fail("the menu has no settings entry");
if (!opened.hasNewSession) fail("the menu has no new-session entry");

await page.evaluate(`(function(){
  const app = document.querySelector("pi-web-app");
  const session = (Reflect.get(app, "state").sessions ?? [])[0];
  app.togglePinnedSession(session);
})()`);
await page.evaluate(`(async function(){
  const app = document.querySelector("pi-web-app");
  app.closeQuickSwitcher?.();
  await app.selectMainView("navigation");
  await new Promise((resolve) => setTimeout(resolve, 1200));
})()`);
await page.waitForTimeout(800);

const pinned = await page.evaluate(`(function(){
  const app = document.querySelector("pi-web-app");
  const panel = app.shadowRoot.querySelector("app-navigation-panel");
  const list = panel?.shadowRoot?.querySelector("session-list");
  const headings = [...(list?.shadowRoot?.querySelectorAll(".row-group-heading") ?? [])].map((node) => node.textContent?.trim());
  return { headings, hasList: list !== null && list !== undefined };
})()`);

if (!pinned.hasList) fail("the sessions list did not render for the pin check");
else if (!pinned.headings.includes("Pinned")) fail(`the list has no Pinned group, headings: ${JSON.stringify(pinned.headings)}`);

await page.screenshot({ path: "/tmp/journeys/menu-key.png" });
await browser.close();

if (process.exitCode === 1) process.exit(1);
console.log("PASS: the menu key opens the quick-access menu in place; the list groups pinned sessions");
