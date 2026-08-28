/**
 * PROBE (not a regression check): does focusing the composer move what sits at
 * the bottom of the transcript, where a settled dialog card's Dismiss control
 * lives?
 *
 * The owner's two frames show the composer at rest as a single dashed line, and
 * focused as a solid-bordered box with a "/ @ #" toolbar row and an attach
 * control. Focusing therefore EXPANDS the composer. An earlier run measured only
 * the voice hint's +25px and found the scroller absorbed it from the same edge
 * its content is anchored to; this expansion is larger and was never measured.
 *
 * Nothing in the app focused his composer: both gated paths go through
 * shouldAutoFocusPrompt(), which is false on a phone in PWA display mode
 * (appShellController.ts:41), and the one ungated focusInput() at
 * PromptEditor.ts:431 belongs to restorePrompt, reachable only by recalling a
 * queued message. So the focus most plausibly came from the browser: a tap that
 * landed on the editor focuses it with no code involved.
 *
 * This probe measures the transcript's bottom block before and after focus, at a
 * phone viewport, with the PWA display mode the gate keys off.
 *
 * Usage: node scripts/probe-focus-expansion.mjs [port]
 */
import { chromium } from "@playwright/test";

const PORT = process.argv[2] ?? "8505";
const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const SCREEN = { width: 393, height: 850 };

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

/**
 * The transcript scroller, its bottom block, and the composer's own height.
 * The composer height is what the focus expansion changes; the block rect is
 * what a finger aimed at a card would miss.
 */
const MEASURE = new Function(`
  const walkFor = (root, test) => {
    for (const el of root.querySelectorAll("*")) {
      if (test(el)) return el;
      if (el.shadowRoot) { const found = walkFor(el.shadowRoot, test); if (found) return found; }
    }
    return undefined;
  };
  const chat = walkFor(document, (el) => el.classList && el.classList.contains("chat"));
  const editorHost = document.querySelector("pi-web-app")?.shadowRoot
    ? walkFor(document, (el) => el.tagName === "PROMPT-EDITOR")
    : undefined;
  if (chat === undefined) return undefined;
  const blocks = chat.querySelectorAll(".msg, .message, [data-scroll-anchor-id]");
  const last = blocks[blocks.length - 1];
  const rect = last === undefined ? undefined : last.getBoundingClientRect();
  const editorRect = editorHost === undefined ? undefined : editorHost.getBoundingClientRect();
  return {
    blockTop: rect === undefined ? undefined : Math.round(rect.top),
    blockBottom: rect === undefined ? undefined : Math.round(rect.bottom),
    scrollTop: Math.round(chat.scrollTop),
    maxScroll: Math.round(chat.scrollHeight - chat.clientHeight),
    chatHeight: Math.round(chat.clientHeight),
    composerHeight: editorRect === undefined ? undefined : Math.round(editorRect.height),
    composerTop: editorRect === undefined ? undefined : Math.round(editorRect.top),
    activeTag: (document.activeElement && document.activeElement.tagName) || "(none)",
  };
`);

/** Focus the composer the way a stray tap would: through the element itself. */
const FOCUS_COMPOSER = () => {
  const walkFor = (root, test) => {
    for (const el of root.querySelectorAll("*")) {
      if (test(el)) return el;
      if (el.shadowRoot) { const found = walkFor(el.shadowRoot, test); if (found) return found; }
    }
    return undefined;
  };
  const editor = walkFor(document, (el) => el.classList && el.classList.contains("cm-content"));
  if (editor === undefined) return false;
  editor.focus();
  return true;
};

async function main() {
  const browser = await chromium.launch({ executablePath: EXE });
  try {
    // The gate keys off display-mode: standalone, so the probe runs in the mode
    // the owner's device is actually in.
    const context = await browser.newContext({
      viewport: SCREEN,
      hasTouch: true,
      isMobile: true,
      reducedMotion: "reduce",
    });
    await context.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query) => (query.includes("display-mode: standalone")
        ? { matches: true, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }
        : original(query));
    });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    await page.evaluate(DEEP_CLICK, "pi-web/Users");
    await page.waitForTimeout(2000);
    await page.evaluate(DEEP_CLICK, "main");
    await page.waitForTimeout(2500);
    const opened = await page.evaluate(() => {
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
    console.log(`session : ${String(opened)} messages`);
    if (opened === 0) {
      console.log("FAIL: no conversation was opened, so nothing could be measured");
      process.exitCode = 1;
      return;
    }

    const before = await page.evaluate(MEASURE);
    console.log(`at rest : ${JSON.stringify(before)}`);
    if (before === undefined || before.blockTop === undefined) {
      console.log("FAIL: no transcript block on screen, so nothing could be measured");
      process.exitCode = 1;
      return;
    }

    const focused = await page.evaluate(FOCUS_COMPOSER);
    await page.waitForTimeout(900);
    const after = await page.evaluate(MEASURE);
    console.log(`focused : ${String(focused)}`);
    console.log(`after   : ${JSON.stringify(after)}`);

    const grew = (after.composerHeight ?? 0) - (before.composerHeight ?? 0);
    const shift = (after.blockTop ?? 0) - before.blockTop;
    console.log(`COMPOSER: ${String(grew)}px taller`);
    console.log(`SHIFT   : ${String(shift)}px`);
    if (grew === 0) console.log("RESULT: the composer did not expand on focus in this build, so this cannot be the source of the movement");
    else if (shift === 0) console.log(`RESULT: NOT REPRODUCED - the composer grew ${String(grew)}px but the transcript's bottom did not move; the scroller absorbed it`);
    else console.log(`RESULT: REPRODUCED - the composer grew ${String(grew)}px and the transcript's bottom moved ${String(shift)}px`);
  } finally {
    await browser.close();
  }
}

await main();
