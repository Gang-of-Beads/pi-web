/**
 * Live check that the session list lays out as tiles on a small phone.
 *
 * The tile rule alone was not enough: a phone reporting ~320 CSS pixels still
 * fell back to one column, and the stylesheet test could not see that. This
 * measures the rendered grid instead.
 *
 * Usage: node scripts/verify-session-tiles.mjs [viewportWidth]
 */
import { chromium } from "@playwright/test";
const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const b = await chromium.launch({ executablePath: exe });
const W = Number(process.argv[2] ?? 390);
const p = await b.newPage({ viewport: { width: W, height: 844 } });
await p.goto("http://127.0.0.1:8505/", { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
// 打开快速切换器：找到打开会话列表的控件
await p.evaluate(() => {
  const walk = (root, out = []) => {
    for (const el of root.querySelectorAll("button,[role=button]")) out.push(el);
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot, out);
    return out;
  };
  const b = walk(document).find((x) => /session|switch/i.test(`${x.getAttribute("aria-label") ?? ""} ${x.title ?? ""}`));
  b?.click();
});
await p.waitForTimeout(1500);
const found = await p.evaluate(() => {
  const walk = (root, out = []) => {
    for (const el of root.querySelectorAll("*")) {
      if (el.classList?.contains("rows") || el.classList?.contains("row-wrap")) out.push(el);
      if (el.shadowRoot) walk(el.shadowRoot, out);
    }
    return out;
  };
  return walk(document).map((el) => {
    const cs = getComputedStyle(el);
    const kids = [...el.children].map((k) => Math.round(k.getBoundingClientRect().width));
    const title = el.querySelector(".row-title");
    return { cls: el.className, cols: cs.gridTemplateColumns, display: cs.display, w: Math.round(el.getBoundingClientRect().width), titleW: title ? Math.round(title.getBoundingClientRect().width) : null };
  });
});
const rows = found.filter((f) => f.cls.includes("rows"));
const wrap = found.find((f) => f.cls.includes("row-wrap"));
const sessionRows = rows.filter((f) => /px \d/u.test(f.cols));
const columns = sessionRows.length === 0 ? 0 : sessionRows[0].cols.trim().split(/\s+/u).length;
console.log(`${W}px  columns=${columns}  tile=${wrap?.w}px  title=${wrap?.titleW}px  menu=${wrap?.display}`);
if (columns < 2) { console.error(`FAIL: expected two columns at ${W}px, got ${columns}`); process.exitCode = 1; }
if (wrap?.display !== "block") { console.error(`FAIL: expected the menu button overlaid at ${W}px`); process.exitCode = 1; }
await b.close();
