/**
 * Live check that every width offers a way to leave the conversation.
 *
 * Usage: node scripts/verify-navigation-reach.mjs
 */
import { chromium } from "@playwright/test";

const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const b = await chromium.launch({ executablePath: exe });
let failed = false;

for (const width of [700, 900, 1100, 1200]) {
  const ctx = await b.newContext({ viewport: { width, height: 900 } });
  const p = await ctx.newPage();
  await p.goto("http://127.0.0.1:8505/", { waitUntil: "networkidle" });
  await p.waitForTimeout(2000);

  const reach = await p.evaluate(() => {
    const found = { header: false, sidebar: false, contextBar: false };
    const walk = (root) => {
      for (const el of root.querySelectorAll("header, aside, nav.context-bar, .context-bar")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const tag = el.tagName.toLowerCase();
        if (tag === "header") found.header = true;
        else if (tag === "aside") found.sidebar = true;
        else found.contextBar = true;
      }
      for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot);
    };
    walk(document);
    return found;
  });

  const ways = Object.entries(reach).filter(([, on]) => on).map(([name]) => name);
  console.log(`${width}px  出口=${ways.length === 0 ? "无" : ways.join("+")}`);
  if (ways.length === 0) { console.error(`  FAIL: ${width}px offers no way out of the conversation`); failed = true; }
  await ctx.close();
}

await b.close();
if (failed) process.exitCode = 1; else console.log("PASS");
