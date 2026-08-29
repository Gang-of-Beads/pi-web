/**
 * PROBE (not a regression check): does a tap aimed at an extension dialog's
 * option row ever land on the card's footer or header instead, at ANY pointer
 * type and EVERY scroll position?
 *
 * The owner's decision for the dialog card is "flow everywhere": phones and
 * desktop both read the footer and header from normal document flow, so the
 * answer controls never overlay the card's own options. Before the decision the
 * footer/header were sticky at fine pointers, which held the footer at the
 * viewport bottom for as long as the card's end was below the fold - exactly
 * over an option row (measured in scripts/probe-dialog-footer-overlap.mjs).
 *
 * This probe measures the real thing against the built bundle: it renders a
 * real extension-dialog-card with enough options to outgrow the window, then at
 * several scroll positions asks the document what element actually sits at the
 * centre of each visible option row - elementFromPoint through the shadow
 * root, not rect math. A tap that would answer the dialog with Cancel instead
 * of the aimed option is a theft.
 *
 * Usage: node scripts/probe-dialog-flow-hit-testing.mjs
 */
import { chromium } from "@playwright/test";

const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const SCREENS = [
  { name: "coarse 393x850", viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true },
  { name: "fine 1440x900", viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false },
];
const OPTION_COUNT = 12;
const SCROLL_STEPS = [0, 200, 320, 420, 520, 620, 720];

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
</style></head><body>
  <div id="scroller">
    <div class="spacer"></div>
    <extension-dialog-card id="card"></extension-dialog-card>
    <div class="spacer"></div>
  </div>
  <script type="module">
    import "${entry}";
    const card = document.getElementById("card");
    card.dialog = {
      dialogId: "probe-flow-1",
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
 * at the row's centre. `stolenBy` names the footer/header member that would
 * receive a tap aimed at the option.
 */
const PROBE_ROWS = () => {
  const card = document.getElementById("card");
  const root = card.shadowRoot;
  const footer = root.querySelector(".dialog-footer");
  const header = root.querySelector(".card-header");
  const rows = [];
  for (const option of root.querySelectorAll(".option-button")) {
    const rect = option.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);
    // Hit-test through the shadow boundary: the top-level element at the point
    // is the host, so ask the shadow root what is really under the finger.
    const outer = document.elementFromPoint(x, y);
    const hit = root.elementFromPoint === undefined ? outer : root.elementFromPoint(x, y) ?? outer;
    const thief = hit === null || hit === undefined ? undefined : footer !== null && footer.contains(hit) ? "footer" : header !== null && header.contains(hit) ? "header" : undefined;
    rows.push({
      label: (option.textContent ?? "").trim(),
      top: Math.round(rect.top),
      hit: hit === null ? "none" : `${hit.tagName.toLowerCase()}.${hit.className || "-"}`,
      stolenBy: thief,
    });
  }
  const footerRect = footer === null ? undefined : footer.getBoundingClientRect();
  return {
    footer: footerRect === undefined ? undefined : { top: Math.round(footerRect.top), bottom: Math.round(footerRect.bottom) },
    header: header === null ? undefined : { top: Math.round(header.getBoundingClientRect().top) },
    scrollTop: Math.round(document.getElementById("scroller").scrollTop),
    rows,
  };
};

async function main() {
  const browser = await chromium.launch({ executablePath: EXE });
  try {
    const index = await (await fetch("http://127.0.0.1:8505/")).text();
    const entry = /src="([^"]*index-[^"]*\.js)"/u.exec(index)?.[1];
    if (entry === undefined) {
      console.log("FAIL: could not find the client entry bundle in index.html");
      process.exitCode = 1;
      return;
    }
    const entryUrl = entry.startsWith("http") ? entry : `/${entry.replace(/^\.?\//u, "")}`;
    console.log(`entry   : ${entryUrl}`);
    let anyTheft = false;
    for (const screen of SCREENS) {
      const context = await browser.newContext({ viewport: screen.viewport, hasTouch: screen.hasTouch, isMobile: screen.isMobile });
      const page = await context.newPage();
      await page.route("**/probe.html", (route) => {
        route.fulfill({ status: 200, contentType: "text/html", body: PAGE(OPTION_COUNT, entryUrl) });
      });
      await page.goto("http://127.0.0.1:8505/probe.html", { waitUntil: "networkidle" });
      await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 15000 });
      await page.waitForTimeout(600);

      console.log(`\nscreen  : ${screen.name}`);
      let thefts = 0;
      let measured = 0;
      for (const scrollTop of SCROLL_STEPS) {
        await page.evaluate((top) => { document.getElementById("scroller").scrollTop = top; }, scrollTop);
        await page.waitForTimeout(150);
        const frame = await page.evaluate(PROBE_ROWS);
        const stolen = frame.rows.filter((row) => row.stolenBy !== undefined);
        measured += frame.rows.length;
        thefts += stolen.length;
        console.log(`scroll ${String(scrollTop).padStart(3)} footer=${JSON.stringify(frame.footer)} headerTop=${String(frame.header?.top)} rows=${String(frame.rows.length)} stolen=${String(stolen.length)}${stolen.length === 0 ? "" : " -> " + stolen.map((r) => `${r.label} hits ${r.hit}`).join(", ")}`);
      }
      console.log(measured === 0 ? "FAIL: no option rows were visible at any measured position" : `measured ${String(measured)} option rows across ${String(SCROLL_STEPS.length)} scroll positions`);
      console.log(thefts === 0
        ? `RESULT (${screen.name}): NOT REPRODUCED - no option row was covered by the footer or header at any measured position`
        : `RESULT (${screen.name}): REPRODUCED - ${String(thefts)} option rows would send their tap to a footer or header control instead`);
      await context.close();
      if (thefts > 0) { anyTheft = true; break; }
    }
    if (anyTheft) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

await main();
