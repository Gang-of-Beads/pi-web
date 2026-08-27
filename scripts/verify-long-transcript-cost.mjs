/**
 * Live measurement of what a long conversation costs to show.
 *
 * Usage: node scripts/verify-long-transcript-cost.mjs [port]
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

const started = Date.now();
await p.goto(`http://127.0.0.1:${port}/?project=${P}&workspace=${W}&session=${S}`, { waitUntil: "networkidle" });
await p.waitForTimeout(4000);

const seen = await p.evaluate(() => {
  const chat = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view")?.shadowRoot?.querySelector(".chat");
  if (!chat) return undefined;
  return { rows: chat.querySelectorAll(".msg").length, nodes: chat.querySelectorAll("*").length, height: Math.round(chat.scrollHeight) };
});
if (seen === undefined) { console.error("FAIL: no transcript rendered, so nothing was measured"); process.exitCode = 1; }
else {
  const scrollStart = Date.now();
  await p.evaluate(() => {
    const chat = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view")?.shadowRoot?.querySelector(".chat");
    if (chat) chat.scrollTop = Math.max(0, chat.scrollHeight - chat.clientHeight - 3000);
  });
  await p.waitForTimeout(600);
  console.log(`加载=${String(Date.now() - started)}ms  消息行=${String(seen.rows)}  DOM节点=${String(seen.nodes)}  转录高度=${String(seen.height)}px  滚动=${String(Date.now() - scrollStart)}ms`);
  if (seen.rows === 0) { console.error("FAIL: the transcript rendered no messages, so this proves nothing"); process.exitCode = 1; }
  else console.log("MEASURED");
}
await ctx.close(); await b.close();
