/**
 * PROBE (not a regression check): does the transcript move out from under a
 * finger that is ALREADY DOWN when a phone's soft keyboard opens?
 *
 * This is the measurement scripts/probe-keyboard-dismiss.mjs did not take. That
 * probe collapsed the visual viewport with no pointer held, and reported -336px.
 * That number describes a reader who is not touching the screen, for whom
 * following the newest content is the wanted behaviour. It does not describe the
 * owner's tap.
 *
 * ChatView already carries ScrollFollowGate for exactly this case: pointerdown
 * on the scroller stops scrollToBottom() from firing until the press ends. So
 * the question this probe answers is whether that existing gate holds when the
 * keyboard opens mid-press, or whether something bypasses it.
 *
 * Reported per press phase, all from the same run:
 *   held    - viewport collapses while the pointer is down
 *   release - the press ends, and pinning is applied afterwards
 *
 * Usage: node scripts/probe-keyboard-with-finger-down.mjs [port]
 */
import { chromium } from "@playwright/test";

const PORT = process.argv[2] ?? "8505";
const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
/** A mid-range phone: 393x850 CSS px, and a keyboard that eats ~336px of it. */
const SCREEN = { width: 393, height: 850 };
const KEYBOARD_HEIGHT = 336;

const DEEP_CLICK = (needle) => {
  const walk = (root, out = []) => {
    for (const el of root.querySelectorAll("button,[role=option],[role=listitem],li,[aria-label]")) out.push(el);
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot, out);
    return out;
  };
  const hit = walk(document).find((x) => `${x.getAttribute("aria-label") ?? ""} ${(x.textContent ?? "").trim()}`.toLowerCase().includes(needle.toLowerCase()));
  hit?.click();
  return hit !== undefined;
};

const FIND_CHAT = `(() => {
  const walk = (root) => {
    for (const el of root.querySelectorAll("*")) {
      if (el.classList && el.classList.contains("chat")) return el;
      if (el.shadowRoot) { const found = walk(el.shadowRoot); if (found) return found; }
    }
    return undefined;
  };
  return walk(document);
})()`;

const BOTTOM_RECT = new Function(`
  const chat = ${FIND_CHAT};
  if (chat === undefined) return undefined;
  const blocks = chat.querySelectorAll(".msg, .message, [data-scroll-anchor-id]");
  const last = blocks[blocks.length - 1];
  if (last === undefined) return undefined;
  const rect = last.getBoundingClientRect();
  return {
    top: Math.round(rect.top),
    scrollTop: Math.round(chat.scrollTop),
    maxScroll: Math.round(chat.scrollHeight - chat.clientHeight),
    clientHeight: Math.round(chat.clientHeight),
  };
`);

/** Press on the scroller itself, which is where the gate listens. */
const PRESS_BOTTOM = new Function(`
  const chat = ${FIND_CHAT};
  if (chat === undefined) return { pressed: false };
  const rect = chat.getBoundingClientRect();
  const x = Math.round(rect.left + rect.width / 2);
  const y = Math.round(rect.bottom - 20);
  const opts = { bubbles: true, composed: true, clientX: x, clientY: y, pointerId: 1, pointerType: "touch", isPrimary: true };
  chat.dispatchEvent(new PointerEvent("pointerdown", opts));
  return { pressed: true, x, y };
`);

const RELEASE = new Function(`
  const chat = ${FIND_CHAT};
  if (chat === undefined) return { released: false };
  const rect = chat.getBoundingClientRect();
  const opts = { bubbles: true, composed: true, clientX: Math.round(rect.left + rect.width / 2), clientY: Math.round(rect.bottom - 20), pointerId: 1, pointerType: "touch", isPrimary: true };
  chat.dispatchEvent(new PointerEvent("pointerup", opts));
  return { released: true };
`);

const OPEN_KEYBOARD = (keyboardHeight) => {
  const viewport = window.visualViewport;
  if (viewport === undefined || viewport === null) return { driven: false };
  const before = viewport.height;
  Object.defineProperty(viewport, "height", { configurable: true, value: before - keyboardHeight });
  viewport.dispatchEvent(new Event("resize"));
  return { driven: true, before: Math.round(before), after: Math.round(viewport.height) };
};

async function main() {
  const browser = await chromium.launch({ executablePath: EXE });
  try {
    const context = await browser.newContext({ viewport: SCREEN, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    await page.evaluate(DEEP_CLICK, "pi-web/Users");
    await page.waitForTimeout(2000);
    await page.evaluate(DEEP_CLICK, "main");
    await page.waitForTimeout(2500);
    const openedSession = await page.evaluate(() => {
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
    await page.waitForTimeout(9000);
    console.log(`session : ${String(openedSession)} messages`);
    if (openedSession === 0) {
      console.log("FAIL: no conversation was opened, so nothing could be measured");
      process.exitCode = 1;
      return;
    }

    const rest = await page.evaluate(BOTTOM_RECT);
    console.log(`at rest : ${JSON.stringify(rest)}`);
    if (rest === undefined) {
      console.log("FAIL: no transcript block on screen, so nothing could be measured");
      process.exitCode = 1;
      return;
    }
    const pinned = rest.maxScroll - rest.scrollTop <= 2;
    console.log(`pinned  : ${String(pinned)} (scrollTop ${String(rest.scrollTop)} of ${String(rest.maxScroll)})`);
    if (!pinned) {
      console.log("FAIL: the reader is not pinned to bottom, which is the state the owner was in");
      process.exitCode = 1;
      return;
    }

    const press = await page.evaluate(PRESS_BOTTOM);
    console.log(`press   : ${JSON.stringify(press)}`);
    const collapse = await page.evaluate(OPEN_KEYBOARD, KEYBOARD_HEIGHT);
    await page.waitForTimeout(800);
    const held = await page.evaluate(BOTTOM_RECT);
    console.log(`keyboard: ${JSON.stringify(collapse)}`);
    console.log(`held    : ${JSON.stringify(held)}`);
    const heldShift = held === undefined ? undefined : held.top - rest.top;
    console.log(`SHIFT held    : ${String(heldShift)}px`);

    await page.evaluate(RELEASE);
    await page.waitForTimeout(1200);
    const after = await page.evaluate(BOTTOM_RECT);
    console.log(`after   : ${JSON.stringify(after)}`);
    const settled = after === undefined ? undefined : after.maxScroll - after.scrollTop <= 2;
    console.log(`SHIFT release : ${String(after === undefined ? undefined : after.top - rest.top)}px, pinned again=${String(settled)}`);

    console.log(heldShift === 0
      ? "RESULT: NOT REPRODUCED with a finger down - the bottom block did not move while the pointer was held"
      : `RESULT: REPRODUCED - the bottom block moved ${String(heldShift)}px while the pointer was held, so the tap would miss`);
  } finally {
    await browser.close();
  }
}

await main();
