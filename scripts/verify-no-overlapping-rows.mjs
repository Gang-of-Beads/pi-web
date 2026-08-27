/**
 * Live check that nothing in the conversation is drawn on top of anything else.
 *
 * Usage: node scripts/verify-no-overlapping-rows.mjs [port]
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

// A sticky header only lifts off its row once the row has scrolled under it,
// so measuring at rest measures the one state where it cannot clash.
await p.evaluate(() => {
  const chat = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view")?.shadowRoot?.querySelector(".chat");
  if (chat) chat.scrollTop = Math.round(chat.scrollHeight / 2);
});
await p.waitForTimeout(700);

const clashes = await p.evaluate(() => {
  const chat = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view")?.shadowRoot?.querySelector(".chat");
  if (!chat) return undefined;
  const rows = [...chat.querySelectorAll(":scope > *")]
    .map((el) => ({ name: `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`, r: el.getBoundingClientRect() }))
    .filter((row) => row.r.height > 0);
  const found = [];
  for (let i = 0; i < rows.length - 1; i += 1) {
    const a = rows[i];
    const c = rows[i + 1];
    // Siblings in a column: the next one starts where the previous ends. More
    // than a pixel of overlap means one is drawn over the other.
    const overlap = Math.round(a.r.bottom - c.r.top);
    if (overlap > 1) found.push(`${a.name} 压住 ${c.name} ${String(overlap)}px`);
  }
  return { rows: rows.length, found };
});

if (clashes === undefined || clashes.rows < 2) {
  console.error("FAIL: fewer than two rows in the conversation, so nothing was compared");
  process.exitCode = 1;
} else {
  console.log(`比较了 ${String(clashes.rows)} 行  重叠=${clashes.found.length === 0 ? "无" : JSON.stringify(clashes.found)}`);
  if (clashes.found.length > 0) process.exitCode = 1; else console.log("PASS");
}
await ctx.close(); await b.close();
