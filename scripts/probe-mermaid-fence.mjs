#!/usr/bin/env node
/**
 * Live check at 393x850: the bundled mermaid plugin claims ```mermaid
 * fences. A valid fence becomes an inline SVG figure (loaded lazily from the
 * vendored bundle, never at boot); a broken one stays a plain code block.
 * Preconditions fail loudly: stack up, seed workspace registered, diagram
 * session listed, chat mounted.
 */
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const BASE = process.env.PI_WEB_PROBE_BASE ?? "http://127.0.0.1:8505";
const MANIFEST = `${process.env.HOME}/.pi-web-8505/pi-web-8505-seed-workspace/seed-manifest.json`;
const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
function fail(message) { console.error(`FAIL: ${message}`); process.exit(1); }

const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
const cwd = manifest.workspace;
const seed = manifest.sessions?.diagram;
if (seed === undefined) fail("seed manifest has no diagram session; run scripts/stack-8505.sh seed");

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true })).newPage();
const vendorLoads = [];
page.on("response", (r) => { if (r.url().includes("/vendor/mermaid/")) vendorLoads.push({ url: r.url().split("/").pop(), status: r.status() }); });
try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("pi-web-app");
  await page.waitForTimeout(3000);
  if (vendorLoads.length > 0) fail(`mermaid vendor bundle loaded at boot: ${JSON.stringify(vendorLoads)}`);
  const result = await page.evaluate(`(async function(){
    const app = document.querySelector("pi-web-app");
    const project = Reflect.get(app, "state").projects.find((p) => p.path === ${JSON.stringify(cwd)});
    if (!project) return { error: "seed workspace is not a project on this stack" };
    await Reflect.get(app, "workspaces").selectProject(project);
    await new Promise((r) => setTimeout(r, 2500));
    const target = (Reflect.get(app, "state").sessions ?? []).find((s) => s.id === ${JSON.stringify(seed.id)});
    if (!target) return { error: "diagram session is not listed" };
    await app.selectNavigationItem("sessions", "chat", () => Reflect.get(app, "sessions").selectSession(target));
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((r) => setTimeout(r, 500));
      const chat = app.shadowRoot.querySelector("chat-view");
      const roots = [chat?.shadowRoot];
      const figures = [];
      const codeBlocks = [];
      const seen = new Set();
      while (roots.length > 0) {
        const root = roots.shift();
        if (!root || seen.has(root)) continue;
        seen.add(root);
        for (const f of root.querySelectorAll("figure.pi-web-mermaid")) figures.push({ svg: f.querySelector("svg") !== null, w: Math.round(f.getBoundingClientRect().width) });
        for (const c of root.querySelectorAll("pre > code")) { const r = c.closest("pre").getBoundingClientRect(); codeBlocks.push({ text: c.textContent.trim().slice(0, 40), visible: r.width > 8 && r.height > 8, w: Math.round(r.width), h: Math.round(r.height), claimed: c.closest(".code-block-wrapper")?.classList.contains("code-fence-claimed") ?? false }); }
        for (const el of root.querySelectorAll("*")) if (el.shadowRoot) roots.push(el.shadowRoot);
      }
      if (figures.length > 0) return { figures, codeBlocks };
    }
    return { error: "no mermaid figure appeared within 20s" };
  })()`);
  if (result.error) fail(result.error);
  console.log(JSON.stringify(result));
  if (result.figures.length !== 1 || !result.figures[0].svg) fail(`expected exactly one drawn diagram, got ${JSON.stringify(result.figures)}`);
  if (result.figures[0].w > 393) fail("diagram figure overflows the phone width");
  if (!result.codeBlocks.some((block) => block.text.startsWith("this is not a diagram") && block.visible)) fail(`broken fence did not stay a visible code block: ${JSON.stringify(result.codeBlocks)}`);
  const source = result.codeBlocks.find((block) => block.text.startsWith("graph TD"));
  if (source === undefined) fail("the drawn fence's source left the DOM (copy needs it)");
  if (source.visible) fail("the drawn fence's source block is still shown beside the diagram");
  if (vendorLoads.length === 0) fail("mermaid vendor bundle never loaded");
  await page.evaluate(`document.querySelector("pi-web-app").shadowRoot.querySelector("chat-view").shadowRoot.querySelector("figure.pi-web-mermaid")?.scrollIntoView()`);
  await page.screenshot({ path: "/tmp/journeys/mermaid-diagram.png" });
  console.log(`PASS: mermaid fence drawn lazily (${String(vendorLoads.length)} vendor files after open, none at boot); broken fence stays a code block`);
} finally {
  await browser.close();
}
