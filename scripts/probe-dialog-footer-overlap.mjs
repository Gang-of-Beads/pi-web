/**
 * PROBE (not a regression check): does the extension dialog card's sticky footer
 * cover the card's own option rows, and does a tap aimed at an option reach the
 * footer's button instead?
 *
 * The owner photographed three frames of a "select" dialog on a phone: the
 * footer holding Cancel floated mid-card, sitting exactly over an option row,
 * and only dropped to its natural place once he scrolled far enough. A bottom
 * sticky element is glued to the viewport bottom for as long as its container's
 * end is below the fold, so it necessarily overlays its own earlier siblings -
 * and the option buttons are those siblings.
 *
 * This measures the real thing rather than the stylesheet: it renders a real
 * extension-dialog-card with enough options to outgrow the window, then at
 * several scroll positions asks the document what element actually sits at the
 * centre of each option row. Answering the wrong question is worse than missing
 * a tap, so the assertion is elementFromPoint, not just rect overlap.
 *
 * Usage: node scripts/probe-dialog-footer-overlap.mjs
 */
import { chromium } from "@playwright/test";

const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
/** A mid-range phone, matching the other probes so the numbers compare. */
const SCREEN = { width: 393, height: 850 };
const OPTION_COUNT = 12;
/** Which sticky family member to test: the footer, or its header sibling. */
const STICKY_SELECTOR = process.env.PROBE_STICKY === "header" ? ".card-header" : ".dialog-footer";

/**
 * The card is exercised standalone against the built bundle. Its geometry is a
 * property of its own stylesheet, so the surrounding app is not needed and its
 * scroll restoration would only add noise.
 */
const PAGE = (optionCount, entry) => `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  html,body{margin:0;background:#111;color:#eee;font:14px system-ui,sans-serif}
  #scroller{height:100vh;overflow-y:auto}
  .spacer{height:60vh}
</style></head>
<body>
  <div id="scroller">
    <div class="spacer"></div>
    <extension-dialog-card id="card"></extension-dialog-card>
    <div class="spacer"></div>
  </div>
  <script type="module">
    import "${entry}";
    const card = document.getElementById("card");
    card.dialog = {
      dialogId: "probe-1",
      kind: "select",
      title: "Extension updates available",
      message: "github.com/nicobailon/pi-subagents",
      options: Array.from({ length: ${optionCount} }, (_, i) => i === 0 ? "Update now" : i === 1 ? "Skip" : "Option " + (i + 1)),
    };
    window.__ready = true;
  </script>
</body></html>`;

/**
 * For each option row: its rect, and what the browser says is actually on top
 * at the row's centre. `stolenBy` is the footer button that would receive a tap
 * aimed at the option.
 */
const PROBE_ROWS = (stickySelector) => {
  const card = document.getElementById("card");
  const root = card.shadowRoot;
  const footer = root.querySelector(stickySelector);
  const footerRect = footer === null ? undefined : footer.getBoundingClientRect();
  const rows = [];
  for (const option of root.querySelectorAll(".option-button")) {
    const rect = option.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);
    // Hit-test through the shadow boundary: the top-level element at the point
    // is the host, so ask the shadow root what is really under the finger.
    const outer = document.elementFromPoint(x, y);
    const inner = root.elementFromPoint === undefined ? outer : root.elementFromPoint(x, y);
    const hit = inner ?? outer;
    rows.push({
      label: (option.textContent ?? "").trim(),
      top: Math.round(rect.top),
      hit: hit === null ? "none" : `${hit.tagName.toLowerCase()}.${hit.className || "-"}`,
      hitText: hit === null ? "" : (hit.textContent ?? "").trim().slice(0, 20),
      stolen: hit !== null && hit !== option && footer !== null && footer.contains(hit),
    });
  }
  return {
    footer: footerRect === undefined ? undefined : { top: Math.round(footerRect.top), bottom: Math.round(footerRect.bottom) },
    scrollTop: Math.round(document.getElementById("scroller").scrollTop),
    rows,
  };
};

async function main() {
  const browser = await chromium.launch({ executablePath: EXE });
  try {
    const context = await browser.newContext({ viewport: SCREEN, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    // The bundle name is content-hashed, so the entry is read from the app's
    // own index.html rather than guessed.
    const index = await (await fetch("http://127.0.0.1:8505/")).text();
    const entry = /src="([^"]*index-[^"]*\.js)"/u.exec(index)?.[1];
    if (entry === undefined) {
      console.log("FAIL: could not find the client entry bundle in index.html");
      process.exitCode = 1;
      return;
    }
    const entryUrl = entry.startsWith("http") ? entry : `/${entry.replace(/^\.?\//u, "")}`;
    console.log(`entry   : ${entryUrl}`);
    await page.route("**/probe.html", (route) => {
      route.fulfill({ status: 200, contentType: "text/html", body: PAGE(OPTION_COUNT, entryUrl) });
    });
    await page.goto("http://127.0.0.1:8505/probe.html", { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 15000 });
    await page.waitForTimeout(600);

    console.log(`sticky  : ${STICKY_SELECTOR}`);
    const present = await page.evaluate((selector) => document.getElementById("card")?.shadowRoot?.querySelector(selector) !== null, STICKY_SELECTOR);
    if (present !== true) {
      console.log("FAIL: the card did not render a footer, so nothing could be measured");
      process.exitCode = 1;
      return;
    }

    let thefts = 0;
    let measured = 0;
    for (const scrollTop of [0, 200, 320, 420, 520, 620]) {
      await page.evaluate((top) => { document.getElementById("scroller").scrollTop = top; }, scrollTop);
      await page.waitForTimeout(150);
      const frame = await page.evaluate(PROBE_ROWS, STICKY_SELECTOR);
      const stolen = frame.rows.filter((row) => row.stolen);
      measured += frame.rows.length;
      thefts += stolen.length;
      console.log(`scroll ${String(scrollTop).padStart(3)} footer=${JSON.stringify(frame.footer)} rows=${String(frame.rows.length)} stolen=${String(stolen.length)}${stolen.length === 0 ? "" : " -> " + stolen.map((r) => `${r.label} hits ${r.hitText}`).join(", ")}`);
    }

    console.log(`\nmeasured ${String(measured)} option rows across 6 scroll positions`);
    console.log(thefts === 0
      ? "RESULT: NOT REPRODUCED - no option row was covered by the footer at any measured position"
      : `RESULT: REPRODUCED - ${String(thefts)} option rows would send their tap to a footer button instead`);
  } finally {
    await browser.close();
  }
}

await main();
