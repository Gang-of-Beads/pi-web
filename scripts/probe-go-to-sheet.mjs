#!/usr/bin/env node
/**
 * Live check at 393x850: the phone lists no tool tiles under the sessions;
 * the Go to control in the bar opens the extension page listing Sessions,
 * Chat and every tool; picking Git opens the git page and the bar names it;
 * Go to from that page lists Git as current.
 */
import { chromium } from "playwright";

const BASE = process.env.PI_WEB_PROBE_BASE ?? "http://127.0.0.1:8505";
const REPO = `${process.env.HOME}/.pi-web-8505/pi-web-8505-worktree-probe/repo`;
const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
function fail(message) { console.error(`FAIL: ${message}`); process.exit(1); }

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true })).newPage();
try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("pi-web-app");
  await page.waitForTimeout(3000);
  const result = await page.evaluate(`(async function(){
    const app = document.querySelector("pi-web-app");
    const project = Reflect.get(app, "state").projects.find((p) => p.path === ${JSON.stringify(REPO)});
    if (!project) return { error: "git probe repository is not a project; run scripts/probe-git-worktree-add.mjs first" };
    await Reflect.get(app, "workspaces").selectProject(project);
    await new Promise((r) => setTimeout(r, 2500));
    const session = (Reflect.get(app, "state").sessions ?? [])[0];
    if (!session) return { error: "the probe repository has no session to open" };
    await app.selectNavigationItem("sessions", "chat", () => Reflect.get(app, "sessions").selectSession(session));
    await new Promise((r) => setTimeout(r, 2500));
    const bar0 = app.shadowRoot.querySelector("app-context-bar");
    const goTo = bar0?.shadowRoot?.querySelector("button[aria-label='Go to a view']");
    if (!goTo) return { error: "no Go to control in the chat bar" };
    const rect = goTo.getBoundingClientRect();
    goTo.click();
    await new Promise((r) => setTimeout(r, 800));
    const sheet = app.shadowRoot.querySelector("app-go-to-sheet");
    if (!sheet) return { error: "Go to sheet did not open" };
    const rows = [...sheet.shadowRoot.querySelectorAll("button.destination")];
    const labels = rows.map((row) => row.querySelector(".destination-label").textContent);
    const git = rows.find((row) => row.querySelector(".destination-label").textContent === "Git");
    if (!git) return { error: "Git is not a destination", labels };
    git.click();
    await new Promise((r) => setTimeout(r, 1500));
    if (app.shadowRoot.querySelector("app-go-to-sheet")) return { error: "sheet stayed open after choosing" };
    const bar = app.shadowRoot.querySelector("app-context-bar");
    const title = bar?.shadowRoot?.querySelector(".session-title-text")?.textContent ?? "";
    const barGoTo = bar?.shadowRoot?.querySelector("button[aria-label='Go to a view']");
    if (!barGoTo) return { error: "no Go to control in the chat/tool bar" };
    barGoTo.click();
    await new Promise((r) => setTimeout(r, 800));
    const again = app.shadowRoot.querySelector("app-go-to-sheet");
    const current = [...(again?.shadowRoot?.querySelectorAll("button.destination[aria-current=true] .destination-label") ?? [])].map((el) => el.textContent);
    return { labels, title, current, controlHeight: Math.round(rect.height), right: Math.round(393 - rect.right) };
  })()`);
  if (result.error) fail(result.error + (result.labels ? " " + JSON.stringify(result.labels) : ""));
  console.log(JSON.stringify(result));
  for (const expected of ["Sessions", "Chat", "Files", "Git", "Terminal", "Info"]) if (!result.labels.includes(expected)) fail(`destination ${expected} missing from ${JSON.stringify(result.labels)}`);
  if (!result.title.startsWith("Git")) fail(`bar title after choosing Git: ${result.title}`);
  if (!result.current.includes("Git")) fail(`Go to from the git page does not mark Git current: ${JSON.stringify(result.current)}`);
  if (result.controlHeight !== 36) fail(`Go to control is ${String(result.controlHeight)}px tall, not 36`);
  await page.screenshot({ path: "/tmp/journeys/go-to-sheet.png" });
  console.log("PASS: Go to lists every destination; Git opens and is marked current");
} finally {
  await browser.close();
}
