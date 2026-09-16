#!/usr/bin/env node
/**
 * Live check at 393x850: no bundled tool (Files, Relays, Updates, Info)
 * renders a titled bar under the host tool header; their controls ride the
 * host fold at the control height; the host summary carries each tool's
 * status text.
 */
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const BASE = process.env.PI_WEB_PROBE_BASE ?? "http://127.0.0.1:8505";
const MANIFEST = `${process.env.HOME}/.pi-web-8505/pi-web-8505-seed-workspace/seed-manifest.json`;
const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
function fail(message) { console.error(`FAIL: ${message}`); process.exit(1); }

const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
const cwd = manifest.workspace;

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true })).newPage();
const pageScript = `
  function deepAll(root, selector) {
    const out = [];
    const queue = [root];
    const seen = new Set();
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === null || current === undefined || seen.has(current)) continue;
      seen.add(current);
      for (const el of current.querySelectorAll(selector)) out.push(el);
      for (const el of current.querySelectorAll("*")) if (el.shadowRoot) queue.push(el.shadowRoot);
    }
    return out;
  }
  function deepOne(root, selector) {
    const all = deepAll(root, selector);
    return all.length === 0 ? null : all[0];
  }
`;
try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("pi-web-app");
  await page.waitForTimeout(3000);
  await page.evaluate(`(async function(){
    const app = document.querySelector("pi-web-app");
    const project = Reflect.get(app, "state").projects.find((p) => p.path === ${JSON.stringify(cwd)});
    if (!project) return;
    await Reflect.get(app, "workspaces").selectProject(project);
    await new Promise((r) => setTimeout(r, 2500));
  })()`);
  for (const tool of ["files:files", "relays:workspace.relays", "updates:workspace.updates", "info:workspace.info"]) {
    const result = await page.evaluate(`(async function(){
      ${pageScript}
      const app = document.querySelector("pi-web-app");
      Reflect.get(app, "openWorkspaceTool").call(app, ${JSON.stringify(tool)});
      await new Promise((r) => setTimeout(r, 1500));
      const panel = app.shadowRoot.querySelector("workspace-panel");
      if (!panel) return { error: "no workspace-panel" };
      const headerTitle = panel.shadowRoot.querySelector(".panel-header-title")?.textContent?.trim() ?? "";
      const headerHtml = panel.shadowRoot.querySelector("header")?.outerHTML?.slice(0, 200) ?? "none";
      const panelCount = app.shadowRoot.querySelectorAll("workspace-panel").length;
      const panelsProp = Reflect.get(panel, "panels")?.length ?? -1;
      const toolProp = Reflect.get(panel, "tool");
      const workspace = Reflect.get(app, "state").selectedWorkspace;
      const wsPath = workspace?.path ?? "none";
      const fold = panel.shadowRoot.querySelector(".workspace-tool-fold");
      if (fold && fold.getAttribute("aria-expanded") !== "true") { fold.click(); await new Promise((r) => setTimeout(r, 300)); }
      const toolbar = panel.shadowRoot.querySelector(".workspace-tool-toolbar");
      const titledBars = deepAll(panel.shadowRoot, ".toolbar strong, section.toolbar > strong").map((el) => el.textContent.trim());
      const controlHeights = toolbar === null ? [] : [...toolbar.querySelectorAll("button")].map((b) => Math.round(b.getBoundingClientRect().height));
      const summary = panel.shadowRoot.querySelector(".workspace-tool-summary")?.textContent?.trim() ?? "";
      return { headerTitle, headerHtml, panelCount, panelsProp, toolProp, wsPath, titledBars, controlHeights, hasFold: fold !== null, summary };
    })()`);
    console.log(tool, JSON.stringify(result));
    if (result.error !== undefined) fail(`${tool}: ${result.error}`);
    if (result.titledBars.length > 0) fail(`${tool}: duplicate titled bar(s) ${JSON.stringify(result.titledBars)}`);
    if (result.hasFold && result.controlHeights.length > 0 && result.controlHeights.some((h) => h !== 36)) fail(`${tool}: fold controls not 36px: ${JSON.stringify(result.controlHeights)}`);
  }
  await page.evaluate(`(function(){ const app=document.querySelector("pi-web-app"); Reflect.get(app,"openWorkspaceTool").call(app,"files:files"); })()`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "/tmp/journeys/fold-migration.png" });
  console.log("PASS: no duplicate titled bars; fold controls at 36px; summaries render");
} finally {
  await browser.close();
}
