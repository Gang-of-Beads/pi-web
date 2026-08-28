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

// Walk in the way a reader does. Naming one session by its message count tied
// the script to one machine's data; the busiest session is whichever one has
// the most to scroll, which is the only property this check needs.
await clickBy("pi-web/Users");
await p.waitForTimeout(2000);
await clickBy("main");
await p.waitForTimeout(2500);
const opened = await p.evaluate(() => {
  const walk = (root, out = []) => {
    for (const el of root.querySelectorAll("button,[role=listitem],li")) out.push(el);
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot, out);
    return out;
  };
  const rows = walk(document)
    .map((el) => ({ el, count: Number(/(\d+)\s+messages/u.exec(el.textContent ?? "")?.[1] ?? 0) }))
    .filter((row) => row.count > 0)
    .sort((left, right) => right.count - left.count);
  rows[0]?.el.click();
  return rows[0]?.count ?? 0;
});
// The busiest session is tens of thousands of messages; on a cold server it is
// still laying out well after the network goes quiet, and clicking into a
// half-built transcript measures nothing.
await p.waitForTimeout(9000);
if (opened === 0) {
  console.error("FAIL: no conversation was opened, so nothing below was measured");
  process.exit(1);
}

const probe = () => p.evaluate(() => {
  const walk = (root, out = { chat: undefined, button: undefined }) => {
    for (const el of root.querySelectorAll(".chat")) out.chat ??= el;
    for (const el of root.querySelectorAll(".jump-to-bottom")) out.button ??= el;
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot, out);
    return out;
  };
  const { chat, button } = walk(document);
  const message = chat?.querySelector(".msg");
  return {
    // The button belongs to the conversation, so it is measured against the
    // conversation rather than the panel - measuring against the panel let it
    // hang past the messages and sit on the scrollbar. It is inset from the
    // message's border rather than flush with it: the reading column takes the
    // full width, so a flush button drew its edge on the card's own border and
    // the two lines read as one welded control.
    alignment: button === undefined || message === null || message === undefined
      ? null
      : Math.round(message.getBoundingClientRect().right - button.getBoundingClientRect().right),
    scrollbar: chat === undefined ? null : chat.offsetWidth - chat.clientWidth,
    scrollable: chat === undefined ? null : chat.scrollHeight > chat.clientHeight + 4,
    distance: chat === undefined ? null : Math.round(chat.scrollHeight - chat.scrollTop - chat.clientHeight),
    button: button !== undefined,
    box: button === undefined ? null : (() => { const r = button.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
    overlaps: button === undefined ? null : (() => {
      const r = button.getBoundingClientRect();
      const hits = [];
      const walk = (root) => {
        for (const el of root.querySelectorAll(".activity-dock, .idle-dock, [class*=dock], [class*=status]")) {
          const o = el.getBoundingClientRect();
          if (o.width > 40 && o.height > 10 && !(o.right < r.left || o.left > r.right || o.bottom < r.top || o.top > r.bottom)) {
            hits.push(String(el.className).slice(0, 24));
          }
        }
        for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot);
      };
      walk(document);
      return hits;
    })(),
    docks: (() => {
      const found = [];
      const walk = (root) => {
        for (const el of root.querySelectorAll(".activity-dock, .idle-dock, [class*=dock], [class*=status]")) {
          const o = el.getBoundingClientRect();
          if (o.width > 40 && o.height > 10) found.push(String(el.className).slice(0, 24));
        }
        for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot);
      };
      walk(document);
      return found;
    })(),
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

// This engine draws overlay scrollbars, so the scrollbar measures zero and the
// case that put the button on top of one cannot occur here. Feed the width in
// directly to prove the button actually spends it. Measured while the button is
// still on screen: clicking it takes the button away with the scroll.
const moved = await p.evaluate(() => {
  let button;
  const walk = (root) => {
    for (const el of root.querySelectorAll(".jump-to-bottom")) { button ??= el; }
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot);
  };
  walk(document);
  if (button === undefined) return null;
  const host = button.getRootNode().host;
  if (host === undefined || host === null) return null;
  const before = button.getBoundingClientRect().right;
  host.style.setProperty("--pi-chat-scrollbar", "15px");
  const shift = Math.round(before - button.getBoundingClientRect().right);
  host.style.removeProperty("--pi-chat-scrollbar");
  return shift;
});

await p.evaluate(() => {
  const walk = (root) => {
    for (const el of root.querySelectorAll(".jump-to-bottom")) return el;
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) { const hit = walk(el.shadowRoot); if (hit) return hit; }
    return undefined;
  };
  walk(document)?.click();
});
await p.waitForTimeout(3000);
const returned = await probe();
console.log("点击后:", JSON.stringify(returned));
if (returned.distance !== null && returned.distance > 40) {
  console.error(`FAIL: the button left the reader ${returned.distance}px from the newest message`);
  process.exitCode = 1;
}
if (Array.isArray(scrolledUp.docks) && scrolledUp.docks.length === 0) {
  console.error("FAIL: no status dock was on screen, so the overlap check proves nothing");
  process.exitCode = 1;
}
if (Array.isArray(scrolledUp.overlaps) && scrolledUp.overlaps.length > 0) {
  console.error(`FAIL: the button overlaps ${scrolledUp.overlaps.join(", ")}`);
  process.exitCode = 1;
}
if (returned.button === true) {
  console.error("FAIL: the button is still offering a scroll the reader has made");
  process.exitCode = 1;
}
// One step of the spacing scale, the inset the stylesheet asks for.
const INSET = 8;
if (scrolledUp.alignment === null) {
  console.error("FAIL: no message to line the button up against, so the inset was not checked");
  process.exitCode = 1;
} else if (scrolledUp.alignment < INSET - 1) {
  console.error(`FAIL: the button sits ${String(scrolledUp.alignment)}px inside the message's right border; it needs ${String(INSET)}px so the two edges are not one line`);
  process.exitCode = 1;
} else if (scrolledUp.alignment > INSET + 1) {
  console.error(`FAIL: the button is ${String(scrolledUp.alignment)}px inside the message, further in than the ${String(INSET)}px the stylesheet asks for`);
  process.exitCode = 1;
}
if (moved === null) {
  console.error("FAIL: could not feed a scrollbar width in, so that case is unproven");
  process.exitCode = 1;
} else if (moved !== 15) {
  console.error(`FAIL: a 15px scrollbar moved the button ${String(moved)}px; it would sit on the scrollbar`);
  process.exitCode = 1;
}
if (process.exitCode === undefined || process.exitCode === 0) console.log(`PASS  离消息右边界=${String(scrolledUp.alignment)}px(要求 ${String(INSET)})  满滚动条时让开=${String(moved)}px`);
await b.close();
