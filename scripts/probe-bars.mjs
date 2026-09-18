#!/usr/bin/env node
/**
 * Measures every bar on the phone surfaces: height, the height of the
 * controls inside it, and how far the first/last control sits from the
 * viewport edge. Prints one line per bar so a template drift is a number,
 * not an impression. Read-only; used before and after the bar-template wave.
 */
import { chromium } from "playwright";

const BASE = process.env.PI_WEB_PROBE_BASE ?? "http://127.0.0.1:8505";
const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const MEASURE = `(function(){
  const app = document.querySelector("pi-web-app");
  const bars = [];
  const seen = new Set();
  const roots = [app.shadowRoot];
  const isBar = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    if (r.width < 200 || r.height < 24 || r.height > 72) return false;
    const controls = [...el.querySelectorAll("button, a, input, [role=button]")].filter((c) => { const cr = c.getBoundingClientRect(); return cr.width > 0 && cr.height > 0 && Math.abs((cr.top + cr.height / 2) - (r.top + r.height / 2)) < r.height; });
    return controls.length > 0 && el.matches("header, footer, .panel-header, .compact-header, .toolbar, .context-bar, .compact-actions-row, .git-toolbar, .workspace-tool-toolbar, .status-bar, .actions, .sheet-header, .drawer-header, [class*=toolbar], [class*=header], [class*=bar]");
  };
  while (roots.length) {
    const root = roots.shift();
    if (!root || seen.has(root)) continue;
    seen.add(root);
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) roots.push(el.shadowRoot);
      if (!isBar(el)) continue;
      if (bars.some((b) => b.el === el || b.el.contains(el) || el.contains(b.el))) continue;
      const r = el.getBoundingClientRect();
      const controls = [...el.querySelectorAll("button, a, input, [role=button]")].map((c) => c.getBoundingClientRect()).filter((cr) => cr.width > 0 && cr.height > 0 && cr.top >= r.top - 1 && cr.bottom <= r.bottom + 1);
      if (controls.length === 0) continue;
      const heights = [...new Set(controls.map((c) => Math.round(c.height)))];
      const left = Math.round(Math.min(...controls.map((c) => c.left)));
      const right = Math.round(window.innerWidth - Math.max(...controls.map((c) => c.right)));
      bars.push({ el, host: root.host?.tagName?.toLowerCase() ?? "document", cls: el.className.toString().split(" ").slice(0, 2).join("."), tag: el.tagName.toLowerCase(), h: Math.round(r.height), controls: heights, left, right, top: Math.round(r.top) });
    }
  }
  return bars.map(({ el, ...rest }) => rest).sort((a, b) => a.top - b.top);
})()`;

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true })).newPage();
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("pi-web-app");
await page.waitForTimeout(3000);
const surfaces = {
  sessions: `(async function(){ const app=document.querySelector("pi-web-app"); const p=Reflect.get(app,"state").projects.find((x)=>x.name==="pi-web-8505-seed-workspace")??Reflect.get(app,"state").projects[0]; await Reflect.get(app,"workspaces").selectProject(p); await new Promise(r=>setTimeout(r,2500)); })()`,
  chat: `(async function(){ const app=document.querySelector("pi-web-app"); const s=(Reflect.get(app,"state").sessions??[])[0]; await Reflect.get(app,"openSessionFromQuickSwitcher").call(app,s); await new Promise(r=>setTimeout(r,3000)); })()`,
  git: `(async function(){ const app=document.querySelector("pi-web-app"); Reflect.get(app,"openWorkspaceTool").call(app,"git:workspace.git"); await new Promise(r=>setTimeout(r,2000)); const f=app.shadowRoot.querySelector("workspace-panel")?.shadowRoot?.querySelector(".workspace-tool-fold"); if (f && f.getAttribute("aria-expanded")!=="true") f.click(); await new Promise(r=>setTimeout(r,500)); })()`,
  sheet: `(async function(){ const app=document.querySelector("pi-web-app"); Reflect.get(app,"openNavigate").call(app); await new Promise(r=>setTimeout(r,900)); return true; })()`,
};
for (const [name, script] of Object.entries(surfaces)) {
  await page.evaluate(script);
  const bars = await page.evaluate(MEASURE);
  console.log(`== ${name}`);
  for (const bar of bars) console.log(`  ${String(bar.top).padStart(4)}px ${bar.host}<${bar.tag}.${bar.cls}> h=${String(bar.h)} controls=${bar.controls.join("/")} inset=${String(bar.left)}/${String(bar.right)}`);
  await page.screenshot({ path: `/tmp/journeys/bars-${name}.png` });
}
await browser.close();
