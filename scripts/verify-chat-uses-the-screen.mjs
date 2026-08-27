/**
 * Live check that the conversation and the composer use the same width, and
 * that the width is most of the screen.
 *
 * Usage: node scripts/verify-chat-uses-the-screen.mjs [port]
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

const measured = await p.evaluate(() => {
  const chat = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view")?.shadowRoot;
  const editor = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("prompt-editor")?.shadowRoot;
  const bubble = chat?.querySelector(".msg");
  const field = editor?.querySelector(".markdown-editor");
  if (!bubble || !field) return undefined;
  return {
    screen: window.innerWidth,
    bubble: Math.round(bubble.getBoundingClientRect().width),
    field: Math.round(field.getBoundingClientRect().width),
  };
});

if (measured === undefined) {
  console.error("FAIL: no message bubble or composer rendered, so nothing was measured");
  process.exitCode = 1;
} else {
  const waste = measured.screen - measured.bubble;
  console.log(`屏宽=${String(measured.screen)}  气泡=${String(measured.bubble)}  输入框=${String(measured.field)}  两侧共留白=${String(waste)}px`);
  let failed = false;
  if (Math.abs(measured.bubble - measured.field) > 4) {
    console.error(`FAIL: the conversation is ${String(measured.bubble)}px and the composer is ${String(measured.field)}px; they should line up`);
    failed = true;
  }
  if (waste > 24) {
    console.error(`FAIL: ${String(waste)}px of a ${String(measured.screen)}px screen goes to margins`);
    failed = true;
  }
  if (failed) process.exitCode = 1; else console.log("PASS");
}
await ctx.close(); await b.close();
