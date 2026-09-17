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
  const footer = [...(switcher?.shadowRoot?.querySelectorAll("footer button") ?? [])].map((node) => node.textContent?.trim());
  const create = switcher?.shadowRoot?.querySelector(".create-session, .new-session, button[title*='New session' i]");
  return {
    view: app.displayMainView(),
    session: Reflect.get(app, "state").selectedSession?.id,
    switcher: switcher !== null,
    contextSheet: app.shadowRoot.querySelector("context-switcher-sheet") !== null,
    footer,
    createsSession: create !== null && create !== undefined && !create.disabled,
  };
})()`);

if (!opened.switcher) fail("the menu key did not open the quick-access menu");
if (opened.contextSheet) fail("the menu key still opens the projects sheet");
if (opened.view !== "chat" || opened.session !== before.session) fail("the menu key navigated away from the open session");
if (!opened.footer.includes("Browse machines and projects")) fail(`the menu footer lost its machines-and-projects entry: ${JSON.stringify(opened.footer)}`);
if (!opened.footer.includes("Settings")) fail(`the menu footer has no settings entry: ${JSON.stringify(opened.footer)}`);
if (!opened.createsSession) fail("the menu offers no enabled new-session control");

await page.keyboard.press("Escape");
await page.waitForTimeout(900);
const dismissed = await page.evaluate(`(function(){
  const app = document.querySelector("pi-web-app");
  return {
    switcher: app.shadowRoot.querySelector("quick-switcher") !== null,
    view: app.displayMainView(),
    session: Reflect.get(app, "state").selectedSession?.id,
  };
})()`);
if (dismissed.switcher) fail("the menu did not close on dismissal");
if (dismissed.view !== before.view || dismissed.session !== before.session) fail(`dismissing the menu changed where the reader is: ${JSON.stringify(dismissed)}`);

const pinTarget = await page.evaluate(`(function(){
  const app = document.querySelector("pi-web-app");
  const session = (Reflect.get(app, "state").sessions ?? []).find((entry) => entry.parentSessionPath === undefined && entry.archived !== true);
  if (session === undefined) return { ok: false };
  app.togglePinnedSession(session);
  return { ok: true, id: session.id };
})()`);
if (!pinTarget.ok) fail("no root session available to pin");

await page.evaluate(`(async function(){
  const app = document.querySelector("pi-web-app");
  await app.selectMainView("navigation");
  await new Promise((resolve) => setTimeout(resolve, 1200));
})()`);
await page.waitForTimeout(800);

const pinned = await page.evaluate(`(function(){
  const app = document.querySelector("pi-web-app");
  const panel = app.shadowRoot.querySelector("app-navigation-panel");
  const list = panel?.shadowRoot?.querySelector("session-list");
  const body = list?.shadowRoot?.querySelector(".list-body");
  const nodes = [...(body?.children ?? [])];
  const headingIndex = nodes.findIndex((node) => node.classList.contains("row-group-heading"));
  const firstRowAfterHeading = headingIndex === -1 ? undefined : nodes[headingIndex + 1]?.getAttribute("title");
  return { hasList: list !== null && list !== undefined, headingIndex, firstRowAfterHeading };
})()`);

if (!pinned.hasList) fail("the sessions list did not render for the pin check");
else if (pinned.headingIndex === -1) fail("the list has no Pinned group after pinning a root session");
else if (pinned.firstRowAfterHeading === undefined) fail("the Pinned heading is not followed by a session row");

await page.screenshot({ path: "/tmp/journeys/menu-key.png" });
await browser.close();

if (process.exitCode === 1) process.exit(1);
console.log("PASS: the menu key opens and dismisses the quick-access menu in place; the list groups pinned sessions");
