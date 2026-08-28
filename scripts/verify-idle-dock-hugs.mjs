/**
 * Live check that the quiet activity marker is the size of what it says.
 *
 * The marker used to be placed by coordinates, where leaving one edge free
 * makes a box shrink to its content. Moving it into the column made it a row,
 * and a row stretches: "idle" became a fixed 240px box with one word in its
 * left corner - the empty card above the composer that its own max-width was
 * added to remove.
 *
 * Measured rather than asserted in a stylesheet, because `width: fit-content`
 * is only an intention until a real layout agrees with it.
 *
 * Usage: node scripts/verify-idle-dock-hugs.mjs [viewportWidth]
 */
import { chromium } from "@playwright/test";

const W = Number(process.argv[2] ?? 390);
const PORT = process.env.PI_WEB_VERIFY_PORT ?? "8505";
const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: W, height: 844 } });
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

const clickBy = (source) => page.evaluate((src) => {
  const rx = new RegExp(src, "i");
  const walk = (root, out = []) => {
    for (const el of root.querySelectorAll("button,[role=option]")) out.push(el);
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot, out);
    return out;
  };
  const hit = walk(document).find((x) => rx.test(`${x.getAttribute("aria-label") ?? ""} ${(x.textContent ?? "").trim()}`));
  hit?.click();
  return hit !== undefined;
}, source);

await clickBy("pi-web/Users");
await page.waitForTimeout(2000);
await clickBy("main");
await page.waitForTimeout(2500);

const sessionNames = await page.evaluate(() => {
  const walk = (root, out = []) => {
    for (const el of root.querySelectorAll("button,[role=option],[role=listitem],li")) out.push(el);
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot, out);
    return out;
  };
  return walk(document)
    .map((el) => ({ text: (el.textContent ?? "").trim().replace(/\s+/gu, " "), count: Number(/(\d+)\s+messages/u.exec(el.textContent ?? "")?.[1] ?? 0) }))
    .filter((row) => row.count > 0)
    .sort((left, right) => right.count - left.count)
    .map((row) => row.text.slice(0, 40));
});

const readDock = () => page.evaluate(() => {
  let dock;
  let column;
  const walk = (root) => {
    for (const el of root.querySelectorAll(".activity-dock")) dock ??= el;
    for (const el of root.querySelectorAll(".chat")) column ??= el;
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot);
  };
  walk(document);
  if (dock === undefined) return null;
  const box = dock.getBoundingClientRect();
  // What the row actually holds: the dot, the words, and the gap between them.
  const children = [...dock.children].map((child) => child.getBoundingClientRect()).filter((rect) => rect.width > 0);
  const content = children.length === 0 ? 0 : Math.max(...children.map((r) => r.right)) - Math.min(...children.map((r) => r.left));
  const style = getComputedStyle(dock);
  const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
  return {
    classes: dock.className,
    text: (dock.textContent ?? "").trim().slice(0, 40),
    width: Math.round(box.width),
    content: Math.round(content),
    padding: Math.round(padding),
    columnWidth: column === undefined ? null : Math.round(column.getBoundingClientRect().width),
  };
});

/**
 * A run parked on an extension dialog is marked "asking" and says so, which is
 * a different marker with different rules. Walk the sessions until one is
 * quiet; measuring the wrong state would be an empty pass.
 */
let measured = null;
let visited = 0;
for (const name of sessionNames.slice(0, 6)) {
  const reached = await clickBy(name.slice(0, 24).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));
  if (!reached) continue;
  visited += 1;
  await page.waitForTimeout(4000);
  const dock = await readDock();
  if (dock !== null && /\b(idle|background)\b/u.test(dock.classes)) { measured = dock; break; }
  measured = dock;
  await clickBy("Open sessions");
  await page.waitForTimeout(1000);
}

console.log(`${String(W)}px  sessions=${String(sessionNames.length)} visited=${String(visited)}  dock=${JSON.stringify(measured)}`);

const opened = visited;
if (opened === 0) {
  console.error("FAIL: no conversation was opened, so no marker was measured");
  process.exitCode = 1;
} else if (measured === null) {
  console.error("FAIL: no activity marker on screen, so its width was not checked");
  process.exitCode = 1;
} else if (!/\b(idle|background)\b/u.test(measured.classes)) {
  console.error(`FAIL: the marker was "${measured.classes}", not a quiet state; run this while the session is idle`);
  process.exitCode = 1;
} else if (measured.content === 0) {
  console.error("FAIL: the marker measured no content, so hugging it proves nothing");
  process.exitCode = 1;
} else {
  // Hugging means the box is its content plus its own padding, give or take a
  // sub-pixel. A stretched box overshoots that by a wide margin.
  const expected = measured.content + measured.padding;
  const slack = Math.round(measured.width - expected);
  if (slack > 4) {
    console.error(`FAIL: the marker is ${String(measured.width)}px around ${String(expected)}px of content - ${String(slack)}px of empty box`);
    process.exitCode = 1;
  } else {
    console.log(`PASS  "${measured.text}" 宽=${String(measured.width)}px 内容+内边距=${String(expected)}px 空余=${String(slack)}px (列宽 ${String(measured.columnWidth)}px)`);
  }
}

await browser.close();
