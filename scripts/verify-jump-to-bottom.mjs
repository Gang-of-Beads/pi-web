/**
 * Live check that the way back to the newest message appears only when the
 * newest message is out of reach, and actually returns the reader.
 *
 * Usage: node scripts/verify-jump-to-bottom.mjs [viewportWidth]
 */
import { chromium } from "@playwright/test";

const W = Number(process.argv[2] ?? 390);
const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const b = await chromium.launch({ executablePath: exe });
const p = await b.newPage({ viewport: { width: W, height: 844 } });
await p.goto("http://127.0.0.1:8505/", { waitUntil: "networkidle" });
await p.waitForTimeout(2500);

const clickBy = (re) => p.evaluate((src) => {
  const rx = new RegExp(src, "i");
  const walk = (root, out = []) => {
    for (const el of root.querySelectorAll("button,[role=option]")) out.push(el);
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot, out);
    return out;
  };
  const hit = walk(document).find((x) => rx.test(`${x.getAttribute("aria-label") ?? ""} ${(x.textContent ?? "").trim()}`));
  hit?.click();
  return hit !== undefined;
}, re);

await clickBy("Open sessions");
await p.waitForTimeout(1200);
await clickBy("117 mes");
await p.waitForTimeout(3500);

const probe = () => p.evaluate(() => {
  const walk = (root, out = { chat: undefined, button: undefined }) => {
    for (const el of root.querySelectorAll(".chat")) out.chat ??= el;
    for (const el of root.querySelectorAll(".jump-to-bottom")) out.button ??= el;
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot, out);
    return out;
  };
  const { chat, button } = walk(document);
  return {
    scrollable: chat === undefined ? null : chat.scrollHeight > chat.clientHeight + 4,
    distance: chat === undefined ? null : Math.round(chat.scrollHeight - chat.scrollTop - chat.clientHeight),
    button: button !== undefined,
  };
});

console.log("底部时:", JSON.stringify(await probe()));

await p.evaluate(() => {
  const walk = (root) => {
    for (const el of root.querySelectorAll(".chat")) return el;
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) { const hit = walk(el.shadowRoot); if (hit) return hit; }
    return undefined;
  };
  const chat = walk(document);
  if (chat) { chat.scrollTop = 0; chat.dispatchEvent(new Event("scroll")); }
});
await p.waitForTimeout(1200);
const scrolledUp = await probe();
console.log("滚到顶后:", JSON.stringify(scrolledUp));

if (scrolledUp.scrollable !== true) {
  console.error("FAIL: this transcript does not scroll, so the check proves nothing");
  process.exitCode = 1;
} else if (scrolledUp.button !== true) {
  console.error("FAIL: the newest message was out of reach and no way back was offered");
  process.exitCode = 1;
}

await p.evaluate(() => {
  const walk = (root) => {
    for (const el of root.querySelectorAll(".jump-to-bottom")) return el;
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) { const hit = walk(el.shadowRoot); if (hit) return hit; }
    return undefined;
  };
  walk(document)?.click();
});
await p.waitForTimeout(1500);
const returned = await probe();
console.log("点击后:", JSON.stringify(returned));
if (returned.distance !== null && returned.distance > 40) {
  console.error(`FAIL: the button left the reader ${returned.distance}px from the newest message`);
  process.exitCode = 1;
}
if (returned.button === true) {
  console.error("FAIL: the button is still offering a scroll the reader has made");
  process.exitCode = 1;
}
await b.close();
