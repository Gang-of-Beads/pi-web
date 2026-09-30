#!/usr/bin/env node
/**
 * Live check at 393x850, coarse pointer: rule 7 of docs/design/state-diagram.md
 * (PI WEB owns the chrome) for the Goals plugin (B23).
 *
 * Legs:
 * 1. precondition: a session of the seed workspace opens in the chat view;
 * 2. nothing sits between the context bar and the transcript;
 * 3. the Go to page lists Goals, with the open-task count before the page was ever opened;
 * 4. tapping Goals opens a page whose bar is titled Goals;
 * 5. that page shows the seeded goal's objective;
 * 6. the goal row, its status dot included, sits inside the reading edge.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.PI_WEB_PROBE_BASE ?? "http://127.0.0.1:8505";
const PROJECT_ID = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const OBJECTIVE = "Goals page probe objective";
const SEED_GOALS = `${process.env.HOME}/.pi-web-8505/pi-web-8505-seed-workspace/.pi/goals`;
mkdirSync(SEED_GOALS, { recursive: true });
writeFileSync(`${SEED_GOALS}/active_goal_2026093000000000_goalspage-probe.md`, JSON.stringify({ id: "goalspage-probe", objective: OBJECTIVE, status: "active", taskList: { tasks: [{ id: "a", title: "one", status: "complete" }, { id: "b", title: "two", status: "pending" }] }, updatedAt: "2026-09-30T00:00:00Z" }, null, 2));
const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const results = [];
function leg(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` ${JSON.stringify(detail)}`}`);
}

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const page = await context.newPage();
try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("pi-web-app");
  await page.waitForTimeout(3000);
  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  const opened = await page.evaluate(`(async function(){
    const app = document.querySelector("pi-web-app");
    const project = Reflect.get(app, "state").projects.find((p) => p.id === ${JSON.stringify(PROJECT_ID)});
    if (!project) return { error: "seed project missing" };
    await Reflect.get(app, "workspaces").selectProject(project);
    await new Promise((r) => setTimeout(r, 2500));
    const session = (Reflect.get(app, "state").sessions ?? [])[0];
    if (!session) return { error: "seed workspace has no session" };
    await Reflect.get(app, "openSessionFromQuickSwitcher").call(app, session);
    await new Promise((r) => setTimeout(r, 3000));
    const state = Reflect.get(app, "state");
    return { selected: state.selectedSession?.id, wanted: session.id, chat: Boolean(app.shadowRoot.querySelector("chat-view")) };
  })()`);
  leg("precondition: seed session open in the chat view", coarse && opened.error === undefined && opened.selected === opened.wanted && opened.chat, { coarse, ...opened });
  if (results.some((entry) => !entry.ok)) throw new Error("precondition failed");

  const chrome = await page.evaluate(`(function(){
    const app = document.querySelector("pi-web-app");
    const chat = app.shadowRoot.querySelector("chat-view");
    const bar = app.shadowRoot.querySelector("app-context-bar");
    const root = chat.shadowRoot;
    const injected = [".top-drawer", ".top-notices", ".drawer-tabs"].filter((selector) => root.querySelector(selector) !== null);
    const scroller = root.querySelector(".chat") ?? root.querySelector("[class*='scroll']");
    const barBottom = Math.round(bar.getBoundingClientRect().bottom);
    const scrollerTop = scroller === null ? -1 : Math.round(scroller.getBoundingClientRect().top);
    return { injected, barBottom, scrollerTop };
  })()`);
  leg("nothing between the bar and the transcript", chrome.injected.length === 0 && chrome.scrollerTop >= 0 && Math.abs(chrome.scrollerTop - chrome.barBottom) <= 1, chrome);

  await page.locator("app-context-bar button[aria-label='Go to a view']").tap();
  await page.waitForTimeout(800);
  const labels = await page.locator("app-go-to-sheet button.destination .destination-label").allTextContents();
  leg("Go to lists Goals", labels.includes("Goals"), { labels });
  let badge = "";
  for (let attempt = 0; attempt < 10 && badge === ""; attempt += 1) {
    badge = (await page.locator("app-go-to-sheet button.destination", { hasText: "Goals" }).locator(".destination-badge").allTextContents()).join("").trim();
    if (badge === "") await page.waitForTimeout(300);
  }
  leg("the Goals entry counts the open task before the page is opened", badge === "1", { badge });

  const goals = page.locator("app-go-to-sheet button.destination", { hasText: "Goals" });
  if (await goals.count() > 0) {
    await goals.first().scrollIntoViewIfNeeded();
    await goals.first().tap();
    await page.waitForTimeout(2500);
    const title = (await page.locator("app-context-bar .session-title-text").first().textContent())?.trim() ?? "";
    const sheetOpen = await page.locator("app-go-to-sheet").count();
    leg("Goals opens a page titled Goals", title.startsWith("Goals") && sheetOpen === 0, { title, sheetOpen });
    const section = await page.evaluate(`(function(){
      const find = (root) => {
        const hit = root.querySelector("pi-web-goals-section");
        if (hit) return hit;
        for (const element of root.querySelectorAll("*")) if (element.shadowRoot) { const inner = find(element.shadowRoot); if (inner) return inner; }
        return null;
      };
      const element = find(document);
      if (!element) return { found: false };
      const root = element.shadowRoot;
      const dot = root.querySelector(".dot")?.getBoundingClientRect();
      return { found: true, text: root.textContent.replace(/\\s+/g, " ").trim().slice(0, 160), dotLeft: dot === undefined ? -1 : Math.round(dot.left), width: innerWidth };
    })()`);
    leg("the page shows the seeded goal", section.found && section.text.includes(OBJECTIVE), section);
    leg("the goal row sits inside the reading edge", section.found && section.dotLeft >= 8, { dotLeft: section.dotLeft });
    await page.screenshot({ path: "/tmp/goals-page-phone.png" });
  }
} catch (error) {
  if (!results.some((entry) => !entry.ok)) leg("probe ran", false, { error: String(error) });
} finally {
  await browser.close();
}
const failed = results.filter((entry) => !entry.ok).length;
console.log(`${String(results.length - failed)}/${String(results.length)} legs passed`);
process.exit(failed === 0 ? 0 : 1);
