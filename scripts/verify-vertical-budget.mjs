/**
 * Live measurement of how much of a phone screen the conversation actually gets.
 *
 * Usage: node scripts/verify-vertical-budget.mjs [port]
 */
import { chromium, devices } from "@playwright/test";

const port = process.argv[2] ?? "8505";
const P = "b8f74304-f20d-43a3-80a0-ad698f90ddd9";
const W = "7a65a4a07e22";
const S = "01a037f1-3fc4-714b-bc11-0b1f46117ea0";
const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const b = await chromium.launch({ executablePath: exe });
const ctx = await b.newContext({ ...devices["Pixel 5"] });
const p = await ctx.newPage();
await p.goto(`http://127.0.0.1:${port}/?project=${P}&workspace=${W}&session=${S}`, { waitUntil: "networkidle" });
await p.waitForTimeout(3500);

const budget = await p.evaluate(() => {
  const root = document.querySelector("pi-web-app")?.shadowRoot;
  const chat = root?.querySelector("chat-view")?.shadowRoot;
  const measure = (el) => (el === null || el === undefined ? 0 : Math.round(el.getBoundingClientRect().height));
  const scroller = chat?.querySelector(".chat");
  if (!scroller) return undefined;
  return {
    screen: window.innerHeight,
    contextBar: measure(root?.querySelector("app-context-bar")),
    drawer: measure(chat?.querySelector(".top-drawer, .drawer-header")),
    conversation: measure(scroller),
    composer: measure(root?.querySelector("prompt-editor")),
    statusBar: measure(root?.querySelector("status-bar")),
  };
});

if (budget === undefined) {
  console.error("FAIL: no conversation rendered, so nothing was measured");
  process.exitCode = 1;
} else {
  const chrome = budget.screen - budget.conversation;
  const share = Math.round((budget.conversation / budget.screen) * 100);
  console.log(`屏高=${String(budget.screen)}  对话=${String(budget.conversation)} (${String(share)}%)  上下文条=${String(budget.contextBar)}  抽屉=${String(budget.drawer)}  输入区=${String(budget.composer)}  状态条=${String(budget.statusBar)}  非对话共=${String(chrome)}`);
  if (share < 50) { console.error(`FAIL: the conversation gets ${String(share)}% of the screen`); process.exitCode = 1; }
  else console.log("PASS");
}
await ctx.close(); await b.close();
