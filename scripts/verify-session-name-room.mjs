/**
 * Live check that the session name, not the machine trail, gets the room in a
 * phone header. Messages went to the wrong session when the header read
 * "machine / ... pi...".
 *
 * Usage: node scripts/verify-session-name-room.mjs
 */
import { chromium, devices } from "@playwright/test";
const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const b = await chromium.launch({ executablePath: exe });
const ctx = await b.newContext({ ...devices["Pixel 5"] });
const p = await ctx.newPage();
await p.goto("http://127.0.0.1:8505/", { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
const click = (re) => p.evaluate((src) => {
  const rx = new RegExp(src, "i");
  const walk = (root, out = []) => {
    for (const el of root.querySelectorAll("button,[role=option]")) out.push(el);
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot, out);
    return out;
  };
  const hit = walk(document).find((x) => rx.test(`${x.getAttribute("aria-label") ?? ""} ${(x.textContent ?? "").trim()}`));
  hit?.click(); return hit !== undefined;
}, re);
await click("session|switch"); await p.waitForTimeout(1500);
await click("messages"); await p.waitForTimeout(3500);
const measured = await p.evaluate(() => {
  const all = [];
  const walk = (root) => {
    for (const el of root.querySelectorAll(".context-breadcrumb, .context-session-title")) {
      const r = el.getBoundingClientRect();
      all.push({ cls: String(el.className).split(" ")[0], 文本: (el.textContent ?? "").trim().slice(0, 22), 宽: Math.round(r.width), 右边缘: Math.round(r.right), 截断: el.scrollWidth > el.clientWidth + 1 });
    }
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot);
  };
  walk(document);
  const bar = [];
  const walk2 = (root) => {
    for (const el of root.querySelectorAll(".context-bar, .context-actions, .context-trail")) {
      const r = el.getBoundingClientRect();
      bar.push({ cls: String(el.className).split(" ")[0], 宽: Math.round(r.width), x: Math.round(r.x) });
    }
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk2(el.shadowRoot);
  };
  walk2(document);
  return { 视口: innerWidth, 项: all.slice(0, 5), 条: bar.slice(0, 4) };
});
console.log(JSON.stringify(measured));
const crumb = measured.项.find((x) => x.cls === "context-breadcrumb");
const title = measured.项.find((x) => x.cls === "context-session-title");
if (title === undefined || crumb === undefined) {
  console.error("FAIL: the phone header did not render a breadcrumb and a session name, so this proves nothing");
  process.exitCode = 1;
} else if (title.宽 <= crumb.宽 * 2) {
  console.error(`FAIL: the session name got ${title.宽}px beside a ${crumb.宽}px trail`);
  process.exitCode = 1;
}
await ctx.close(); await b.close();
