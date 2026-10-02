#!/usr/bin/env node
/**
 * Desktop Go to sheet on the 8505 stack: choosing a tool must put that tool on screen.
 *
 * On a desktop a workspace tool shows in the right-hand panel, which the reader can collapse.
 * Each leg opens Go to from the context bar at 1440x900 under a mouse, chooses a tool, and
 * records whether the workspace panel is on screen with that tool in it - once with the panel
 * open and once with it collapsed.
 */

import { chromium } from "playwright";

const BASE = process.env.PI_WEB_PROBE_BASE ?? "http://127.0.0.1:8505";
const PROJECT = process.env.PI_WEB_PROBE_PROJECT ?? "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = process.env.PI_WEB_PROBE_WORKSPACE ?? "ef2cdf93e1ac";
const SESSION = process.env.PI_WEB_PROBE_SESSION ?? "01a05000-5eed-7c00-8000-0000000000c1";
const PAGE_URL = `${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${SESSION}&view=chat`;
const TOOLS = (process.env.PI_WEB_PROBE_TOOLS ?? "Background,Files").split(",");

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`[${ok ? "ok" : "FAIL"}] ${name}: ${detail}`);
};

async function leg(browser, tool, collapsed) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript((value) => { localStorage.setItem("pi-web-app-panel-collapse", JSON.stringify(value ? { workspacePanelCollapsed: true } : {})); }, collapsed);
  const page = await context.newPage();
  await page.goto(PAGE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  const selected = await page.evaluate(() => document.querySelector("pi-web-app")?.state?.selectedSession?.id ?? null);
  if (selected !== SESSION) throw new Error(`precondition: the app selected ${String(selected)}, not ${SESSION}`);
  const goTo = page.getByRole("button", { name: "Go to a view" });
  if ((await goTo.count()) !== 1) throw new Error(`precondition: ${String(await goTo.count())} "Go to a view" keys on the desktop bar`);
  await goTo.click();
  const tile = page.locator("app-go-to-sheet .destination", { hasText: tool });
  if ((await tile.count()) !== 1) throw new Error(`precondition: no ${tool} tile in Go to`);
  await tile.click();
  await page.waitForTimeout(1500);
  const seen = await page.evaluate((title) => {
    const app = document.querySelector("pi-web-app");
    const panel = app?.shadowRoot?.querySelector("#workspace-panel");
    const box = panel?.getBoundingClientRect();
    const onScreen = box !== undefined && box.width > 40 && box.height > 40 && box.right <= window.innerWidth + 1 && getComputedStyle(panel).visibility !== "hidden";
    const barText = app?.shadowRoot?.querySelector("app-context-bar")?.shadowRoot?.textContent ?? "";
    return { tool: app?.state?.workspaceTool ?? null, view: app?.state?.mainView ?? null, onScreen, width: Math.round(box?.width ?? 0), mentionsTitle: barText.includes(title) };
  }, tool);
  await page.screenshot({ path: `/tmp/goto-desktop-${tool.toLowerCase()}-${collapsed ? "collapsed" : "open"}.png` });
  await context.close();
  record(`${tool} from Go to, panel ${collapsed ? "collapsed" : "open"}: the tool is on screen`, seen.onScreen && seen.mentionsTitle, JSON.stringify(seen));
}

const browser = await chromium.launch();
try {
  for (const collapsed of [false, true]) {
    for (const tool of TOOLS) await leg(browser, tool, collapsed);
  }
} finally {
  await browser.close();
}
const failed = results.filter((result) => !result.ok);
console.log(`RECORDS=${String(results.length)} FAILED=${String(failed.length)}`);
process.exit(failed.length === 0 && results.length === TOOLS.length * 2 ? 0 : 1);
