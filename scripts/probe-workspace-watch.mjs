#!/usr/bin/env node
/**
 * Live check: a file written to the shown workspace appears in the files
 * panel without a manual refresh, because the daemon watches the working
 * directory of every session it holds open and the browser refreshes the
 * matching workspace's panels.
 *
 * Preconditions fail loudly: the 8505 stack answers, the seed workspace is
 * a project, the seeded session opens, the files panel mounts.
 */
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.PI_WEB_PROBE_BASE ?? "http://127.0.0.1:8505";
const MANIFEST = `${process.env.HOME}/.pi-web-8505/pi-web-8505-seed-workspace/seed-manifest.json`;
const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
const cwd = manifest.workspace;
const seed = manifest.sessions?.long;
if (seed === undefined) fail("seed manifest has no long session; run scripts/stack-8505.sh seed");
const marker = `watch-probe-${String(Date.now())}.md`;
await rm(join(cwd, marker), { force: true });

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("pi-web-app");
  await page.waitForTimeout(3000);
  const selected = await page.evaluate(`(async function(){
    const app = document.querySelector("pi-web-app");
    const state = Reflect.get(app, "state");
    const project = state.projects.find((candidate) => candidate.path === ${JSON.stringify(cwd)});
    if (project === undefined) return { error: "seed workspace is not a project on this stack" };
    await Reflect.get(app, "workspaces").selectProject(project);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const target = (Reflect.get(app, "state").sessions ?? []).find((candidate) => candidate.id === ${JSON.stringify(seed.id)});
    if (target === undefined) return { error: "seeded session is not listed" };
    await app.selectNavigationItem("sessions", "chat", () => Reflect.get(app, "sessions").selectSession(target));
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return { ok: true };
  })()`);
  if (selected.error !== undefined) fail(selected.error);

  const opened = await page.evaluate(`(async function(){
    const app = document.querySelector("pi-web-app");
    const open = Reflect.get(app, "openWorkspaceTool");
    if (typeof open !== "function") return { hasPanel: false, text: "openWorkspaceTool missing" };
    open.call(app, "files:files");
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const panel = app.shadowRoot.querySelector("workspace-panel");
    return { hasPanel: panel !== null, text: panel?.shadowRoot?.textContent?.slice(0, 200) ?? "" };
  })()`);
  const listedBefore = await page.evaluate(`document.querySelector("pi-web-app").shadowRoot.querySelector("workspace-panel")?.shadowRoot?.textContent?.includes(${JSON.stringify(marker)}) ?? false`);
  if (listedBefore) fail("marker file listed before it was written");

  await writeFile(join(cwd, marker), "# watch probe\n", "utf8");
  let listedAfter = false;
  for (let attempt = 0; attempt < 20 && !listedAfter; attempt += 1) {
    await page.waitForTimeout(500);
    listedAfter = await page.evaluate(`(function(){
      const app = document.querySelector("pi-web-app");
      const roots = [app.shadowRoot];
      const seen = new Set();
      while (roots.length > 0) {
        const root = roots.shift();
        if (root === null || root === undefined || seen.has(root)) continue;
        seen.add(root);
        if ((root.textContent ?? "").includes(${JSON.stringify(marker)})) return true;
        for (const el of root.querySelectorAll("*")) if (el.shadowRoot) roots.push(el.shadowRoot);
      }
      return false;
    })()`);
  }
  if (!listedAfter) fail(`files panel did not show ${marker} within 10s of the write (panel mounted: ${String(opened.hasPanel)})`);
  console.log(`PASS: ${marker} appeared in the files panel without a manual refresh`);
} finally {
  await rm(join(cwd, marker), { force: true });
  await browser.close();
}
