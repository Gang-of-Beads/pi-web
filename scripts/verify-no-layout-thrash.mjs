/**
 * Live check that transient notices do not shove the conversation around.
 *
 * Usage: node scripts/verify-no-layout-thrash.mjs [viewportWidth]
 */
import { chromium, devices } from "@playwright/test";

const W = Number(process.argv[2] ?? 390);
const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const b = await chromium.launch({ executablePath: exe });
const ctx = await b.newContext(W < 900 ? { ...devices["Pixel 5"] } : { viewport: { width: W, height: 900 } });
const p = await ctx.newPage();
await p.goto("http://127.0.0.1:8505/", { waitUntil: "networkidle" });
await p.waitForTimeout(2500);

// 制造用户描述的状态:横幅/重试/确认反复出现与消失。
const churn = p.evaluate(() => {
  const walk = (root) => {
    for (const el of root.querySelectorAll("pi-web-app")) return el;
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) { const hit = walk(el.shadowRoot); if (hit) return hit; }
    return undefined;
  };
  const app = walk(document);
  if (app === undefined) return false;
  let n = 0;
  const timer = setInterval(() => {
    n += 1;
    const setState = Reflect.get(app, "setState");
    if (typeof setState !== "function") return;
    Reflect.apply(setState, app, [{ error: n % 2 === 0 ? "" : `Transient failure ${String(n)}: connection reset` }]);
    if (n > 20) clearInterval(timer);
  }, 250);
  return true;
});

const shifts = await p.evaluate(() => new Promise((resolve) => {
  const seen = [];
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.hadRecentInput) continue;
      seen.push(Math.round(entry.value * 10000) / 10000);
    }
  });
  try { observer.observe({ type: "layout-shift", buffered: true }); } catch { resolve(null); return; }
  setTimeout(() => { observer.disconnect(); resolve(seen); }, 6000);
}));

const churned = await churn;
if (churned !== true) {
  console.error("FAIL: could not drive the banner state, so this proves nothing");
  process.exitCode = 1;
}
if (shifts === null) {
  console.error("FAIL: this engine does not report layout-shift, so the check proves nothing");
  process.exitCode = 1;
} else {
  const total = shifts.reduce((sum, value) => sum + value, 0);
  console.log(`${W}px  次数=${shifts.length}  累计位移=${Math.round(total * 1000) / 1000}  最大单次=${shifts.length === 0 ? 0 : Math.max(...shifts)}`);
  if (total > 0.1) { console.error(`FAIL: cumulative layout shift ${total} is above the 0.1 that reads as steady`); process.exitCode = 1; }
}
await ctx.close(); await b.close();
