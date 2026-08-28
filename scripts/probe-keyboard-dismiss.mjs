/**
 * PROBE (not a regression check): does a phone's soft keyboard move what is at
 * the bottom of the transcript out from under a finger that is already on it?
 *
 * The hypothesis under test is that the owner's first tap never landed. Focusing
 * the composer opens the keyboard, the keyboard collapses window.visualViewport
 * by roughly 40% of the screen, and ChatView.onViewportResize reacts by calling
 * scrollToBottom() whenever the reader is pinned to bottom. If content moves
 * between pointerdown and pointerup the tap is spent on whatever ends up under
 * the finger, and the second tap works only because the layout has settled.
 *
 * Seeding a settled dialog card was tried and abandoned: `state` is a private
 * Lit field the app reassigns on every render, so a seeded card never survived
 * to be measured. This probe instead measures the LAST REAL ELEMENT at the
 * bottom of the transcript, which is where the card sits in the owner's frame 1
 * and is subject to exactly the same scrolling.
 *
 * Playwright's setViewportSize does NOT move visualViewport, so the collapse is
 * driven directly against the real listeners the app registered.
 *
 * Usage: node scripts/probe-keyboard-dismiss.mjs [port]
 */
import { chromium } from "@playwright/test";

const PORT = process.argv[2] ?? "8505";
const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const CWD = process.env.PI_WEB_VERIFY_CWD ?? "/Users/hanxiao.du/Desktop/vincent/projects/pi-web";
const API = `http://127.0.0.1:${PORT}/api/machines/local`;
/** A mid-range phone: 393x850 CSS px, and a keyboard that eats ~336px of it. */
const SCREEN = { width: 393, height: 850 };
const KEYBOARD_HEIGHT = 336;

/** Click by visible text through shadow roots, the way the other checks navigate. */
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

/**
 * The bottom-most rendered message block, and the scroller's own position. This
 * is the seat the settled card occupies in the owner's first frame.
 */
const BOTTOM_RECT = new Function(`
  const chat = ${FIND_CHAT};
  if (chat === undefined) return undefined;
  const blocks = chat.querySelectorAll(".msg, .message, [data-scroll-anchor-id]");
  const last = blocks[blocks.length - 1];
  if (last === undefined) return undefined;
  const rect = last.getBoundingClientRect();
  return {
    top: Math.round(rect.top),
    bottom: Math.round(rect.bottom),
    scrollTop: Math.round(chat.scrollTop),
    maxScroll: Math.round(chat.scrollHeight - chat.clientHeight),
    clientHeight: Math.round(chat.clientHeight),
  };
`);

/** Collapse the visual viewport the way an opening keyboard does. */
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

    let rest = await page.evaluate(BOTTOM_RECT);
    console.log(`at rest : ${JSON.stringify(rest)}`);
    if (rest === undefined) {
      console.log("FAIL: no transcript block on screen, so nothing could be measured");
      process.exitCode = 1;
      return;
    }
    const pinned = rest.maxScroll - rest.scrollTop <= 2;
    console.log(`pinned  : ${String(pinned)} (scrollTop ${String(rest.scrollTop)} of ${String(rest.maxScroll)})`);

    // Scroll off the bottom first when asked, to separate the scroller's own
    // shrink from the scrollToBottom() that only fires while pinned.
    if (process.env.PROBE_UNPIN === "1") {
      await page.evaluate(() => {
        const walk = (root) => {
          for (const el of root.querySelectorAll("*")) {
            if (el.classList && el.classList.contains("chat")) return el;
            if (el.shadowRoot) { const found = walk(el.shadowRoot); if (found) return found; }
          }
          return undefined;
        };
        const chat = walk(document);
        if (chat !== undefined) chat.scrollTop = chat.scrollTop - 400;
      });
      await page.waitForTimeout(600);
      const unpinned = await page.evaluate(BOTTOM_RECT);
      console.log(`unpinned: ${JSON.stringify(unpinned)}`);
      // The scroll off the bottom is the new baseline; comparing against the
      // pinned rect would report that deliberate scroll as keyboard movement.
      if (unpinned !== undefined) rest = unpinned;
    }

    const collapse = await page.evaluate(OPEN_KEYBOARD, KEYBOARD_HEIGHT);
    await page.waitForTimeout(800);
    const during = await page.evaluate(BOTTOM_RECT);
    console.log(`keyboard: ${JSON.stringify(collapse)}`);
    console.log(`during  : ${JSON.stringify(during)}`);
    if (during === undefined) {
      console.log("RESULT: the bottom block left the document when the keyboard opened");
      return;
    }
    const shift = during.top - rest.top;
    console.log(`SHIFT   : ${String(shift)}px`);
    console.log(shift === 0
      ? "RESULT: NOT REPRODUCED - the bottom of the transcript did not move when the keyboard opened"
      : `RESULT: REPRODUCED - the bottom of the transcript moved ${String(shift)}px, so a finger already on a control there would miss`);
  } finally {
    await browser.close();
  }
}

await main();
