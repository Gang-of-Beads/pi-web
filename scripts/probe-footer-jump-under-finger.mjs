/**
 * PROBE (not a regression check): hypothesis EIGHT for the owner's two-tap
 * Dismiss - does the sticky footer move out from under a finger that is already
 * down, because content growth crosses the point where sticky detaches?
 *
 * scripts/probe-dialog-footer-overlap.mjs measured the detach: while the card's
 * end is below the fold the footer is glued to the viewport bottom (top=784),
 * and once the end rises above the fold it snaps to its natural place (732, 632,
 * 532...). That position is therefore DISCONTINUOUS in scroll position.
 *
 * ScrollFollowGate suppresses the app's programmatic scrollToBottom() while a
 * pointer is down, but sticky repositioning is done by the browser in response
 * to ANY scroll or layout change, so the gate cannot cover it. This probe asks
 * whether that gap is reachable: hold a pointer on the footer's button, grow the
 * content, and measure the button's rect before and during.
 *
 * Usage: node scripts/probe-footer-jump-under-finger.mjs
 */
import { chromium } from "@playwright/test";

const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const SCREEN = { width: 393, height: 850 };

const PAGE = (entry) => `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  html,body{margin:0;background:#111;color:#eee;font:14px system-ui,sans-serif}
  #scroller{height:100vh;overflow-y:auto}
  .spacer{height:60vh}
  #grow{height:0}
</style></head>
<body>
  <div id="scroller">
    <div class="spacer"></div>
    <extension-dialog-card id="card"></extension-dialog-card>
    <div id="grow"></div>
    <div class="spacer"></div>
  </div>
  <script type="module">
    import "${entry}";
    const card = document.getElementById("card");
    card.dialog = {
      dialogId: "probe-2",
      kind: "select",
      title: "Extension updates available",
      message: "github.com/nicobailon/pi-subagents",
      options: ["Update now", "Skip", "Option 3", "Option 4", "Option 5", "Option 6"],
    };
    window.__ready = true;
  </script>
</body></html>`;

/** The footer's answer control - the thing the owner's finger was on. */
const FOOTER_RECT = () => {
  const root = document.getElementById("card").shadowRoot;
  const button = root.querySelector(".dialog-footer button");
  if (button === null) return undefined;
  const rect = button.getBoundingClientRect();
  const scroller = document.getElementById("scroller");
  return {
    top: Math.round(rect.top),
    label: (button.textContent ?? "").trim(),
    scrollTop: Math.round(scroller.scrollTop),
    maxScroll: Math.round(scroller.scrollHeight - scroller.clientHeight),
  };
};

async function main() {
  const browser = await chromium.launch({ executablePath: EXE });
  try {
    const context = await browser.newContext({ viewport: SCREEN, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    const index = await (await fetch("http://127.0.0.1:8505/")).text();
    const entry = /src="([^"]*index-[^"]*\.js)"/u.exec(index)?.[1];
    if (entry === undefined) {
      console.log("FAIL: could not find the client entry bundle in index.html");
      process.exitCode = 1;
      return;
    }
    const entryUrl = `/${entry.replace(/^\.?\//u, "")}`;
    await page.route("**/probe.html", (route) => {
      route.fulfill({ status: 200, contentType: "text/html", body: PAGE(entryUrl) });
    });
    await page.goto("http://127.0.0.1:8505/probe.html", { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 15000 });
    await page.waitForTimeout(600);

    // Sit where the footer is still glued, which is where the owner was.
    await page.evaluate(() => { document.getElementById("scroller").scrollTop = 150; });
    await page.waitForTimeout(200);
    const rest = await page.evaluate(FOOTER_RECT);
    console.log(`at rest : ${JSON.stringify(rest)}`);
    if (rest === undefined) {
      console.log("FAIL: no footer button to measure");
      process.exitCode = 1;
      return;
    }

    // Finger goes down on the button.
    await page.evaluate(() => {
      const root = document.getElementById("card").shadowRoot;
      const button = root.querySelector(".dialog-footer button");
      const rect = button.getBoundingClientRect();
      const opts = { bubbles: true, composed: true, clientX: Math.round(rect.left + rect.width / 2), clientY: Math.round(rect.top + rect.height / 2), pointerId: 1, pointerType: "touch", isPrimary: true };
      button.dispatchEvent(new PointerEvent("pointerdown", opts));
      window.__press = opts;
    });

    // Content grows below the card, the way a streaming reply does. This is what
    // moves the card's end relative to the fold, and so the sticky threshold.
    await page.evaluate(() => { document.getElementById("grow").style.height = "700px"; });
    await page.waitForTimeout(300);
    const grown = await page.evaluate(FOOTER_RECT);
    console.log(`grown   : ${JSON.stringify(grown)}`);
    console.log(`SHIFT growth-only : ${String(grown.top - rest.top)}px`);

    // The transcript follows new content when pinned; that scroll is what
    // carries the card's end up past the fold while the finger is still down.
    await page.evaluate(() => { const s = document.getElementById("scroller"); s.scrollTop = s.scrollHeight; });
    await page.waitForTimeout(300);
    const followed = await page.evaluate(FOOTER_RECT);
    console.log(`followed: ${JSON.stringify(followed)}`);
    const shift = followed.top - rest.top;
    console.log(`SHIFT with follow : ${String(shift)}px`);

    // What is under the original touch point now?
    const landed = await page.evaluate(() => {
      const p = window.__press;
      const el = document.elementFromPoint(p.clientX, p.clientY);
      const root = document.getElementById("card").shadowRoot;
      const inner = root.elementFromPoint === undefined ? null : root.elementFromPoint(p.clientX, p.clientY);
      const hit = inner ?? el;
      return hit === null ? "none" : `${hit.tagName.toLowerCase()}.${hit.className || "-"} "${(hit.textContent ?? "").trim().slice(0, 24)}"`;
    });
    console.log(`under the finger now: ${landed}`);

    console.log(shift === 0
      ? "RESULT: NOT REPRODUCED - the footer button did not move under the held pointer"
      : `RESULT: REPRODUCED - the footer button moved ${String(shift)}px while the pointer was held`);
  } finally {
    await browser.close();
  }
}

await main();
