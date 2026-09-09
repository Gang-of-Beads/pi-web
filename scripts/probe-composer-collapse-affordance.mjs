/**
 * PROBE: when answering a question takes the composer's space, the composer
 * collapses to one line. The owner read that collapsed line as a broken input
 * box - it was a dashed transparent pill that looked like a text field and did
 * not accept text. This probe holds the repaired affordance against the built
 * bundle: the collapsed composer must be a button with a visible expand mark,
 * and activating it must ask to expand.
 *
 * PASS: collapsed state is a solid rounded control (not a dashed pill), the
 * chevron mark is present and draws ink, and a click raises onExpand. FAILS
 * loudly on missing preconditions.
 *
 * Usage: node scripts/probe-composer-collapse-affordance.mjs (8505 stack up)
 */
import { chromium } from "@playwright/test";

const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const SCREEN = { width: 393, height: 850, hasTouch: true, isMobile: true };

const PAGE = (entry) => `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  html,body{margin:0;background:#111;color:#eee;font:14px system-ui,sans-serif}
  :root{
    --pi-space-1:2px;--pi-space-2:4px;--pi-space-3:6px;--pi-space-4:8px;--pi-space-5:10px;
    --pi-space-6:12px;--pi-space-7:16px;--pi-space-8:20px;--pi-space-9:24px;
    --pi-text-2xs:11px;--pi-text-xs:12px;--pi-text-sm:13px;--pi-text-base:14px;--pi-text-md:15px;--pi-text-lg:17px;--pi-text-xl:20px;
    --pi-leading-tight:1.25;--pi-leading-normal:1.45;--pi-weight-regular:400;--pi-weight-medium:500;--pi-weight-semibold:600;
    --pi-radius-xs:4px;--pi-radius-sm:6px;--pi-radius-md:8px;--pi-radius-lg:12px;--pi-radius-xl:16px;--pi-radius-pill:999px;
    --pi-layer-raised:10;--pi-layer-sticky:20;--pi-layer-popover:30;--pi-layer-overlay:40;--pi-layer-dialog:50;--pi-layer-blocking:60;
    --pi-chat-measure:100%;--pi-chat-gutter:16px;--pi-panel-header-height:36px;--pi-panel-header-control-height:28px;
    --pi-control-height:32px;--pi-control-height-touch:44px;--pi-control-height-comfort:36px;
    --pi-dot-sm:8px;--pi-dot-md:16px;--pi-dot-lg:24px;--pi-focus-ring-width:2px;--pi-focus-ring-offset-tight:1px;
    --pi-motion-fast:120ms;--pi-motion-base:180ms;--pi-border:#444;--pi-accent:#7aa2f7;--pi-muted:#999;--pi-text-bright:#fff;
    --pi-surface:#1a1a1a;--pi-row-min-height:52px;
  }
</style></head><body>
  <script type="module">
    import "${entry}";
    const composer = document.createElement("prompt-editor");
    composer.draftSessionId = "local:probe";
    composer.machineId = "local";
    composer.collapsed = true;
    window.__expanded = 0;
    composer.onExpand = () => { window.__expanded += 1; };
    document.body.append(composer);
    window.__ready = true;
  </script>
</body></html>`;

const browser = await chromium.launch({ headless: true, executablePath: EXE });
try {
  const index = await (await fetch("http://127.0.0.1:8505/")).text();
  const entry = /src="([^"]*index-[^"]*\.js)"/u.exec(index)?.[1];
  if (entry === undefined) { console.log("FAIL: no client entry bundle in index.html"); process.exit(1); }
  const entryUrl = entry.startsWith("http") ? entry : `/${entry.replace(/^\.?\//u, "")}`;
  const context = await browser.newContext({ viewport: SCREEN, hasTouch: SCREEN.hasTouch, isMobile: SCREEN.isMobile });
  const page = await context.newPage();
  await page.route("**/probe.html", (route) => { route.fulfill({ status: 200, contentType: "text/html", body: PAGE(entryUrl) }); });
  await page.goto("http://127.0.0.1:8505/probe.html", { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 15000 });
  await page.waitForTimeout(600);

  const state = await page.evaluate(() => {
    const composer = document.querySelector("prompt-editor");
    const root = composer.shadowRoot;
    const expand = root.querySelector(".expand-composer");
    if (expand === null) return { fail: "collapsed composer did not render the expand control" };
    const tag = expand.tagName.toLowerCase();
    const style = getComputedStyle(expand);
    const mark = root.querySelector(".expand-composer-hint .ui-icon");
    return {
      tag, borderStyle: style.borderTopStyle, radius: style.borderTopLeftRadius,
      hasMark: mark !== null, markWidth: mark === null ? 0 : mark.getBoundingClientRect().width,
    };
  });
  if (state.fail !== undefined) { console.log(`FAIL: ${state.fail}`); await browser.close(); process.exit(1); }

  const expanded = await page.evaluate(() => {
    const composer = document.querySelector("prompt-editor");
    composer.shadowRoot.querySelector(".expand-composer").click();
    return window.__expanded;
  });

  const checks = [
    [`collapsed state is a button (got <${state.tag}>)`, state.tag === "button"],
    ["border is solid, not dashed (a dashed transparent box reads as an input)", state.borderStyle === "solid"],
    [`corner is not a pill (got ${state.radius}; a pill reads as an input)`, state.radius !== "999px"],
    ["expand mark is present", state.hasMark === true],
    [`mark draws ink (${state.markWidth}px)`, state.markWidth > 0],
    [`activation asks to expand (${expanded} calls)`, expanded === 1],
  ];
  let pass = true;
  for (const [name, ok] of checks) { console.log(`${ok ? "PASS" : "FAIL"}: ${name}`); pass = pass && ok; }
  await browser.close();
  process.exit(pass ? 0 : 1);
} catch (error) {
  console.log("FAIL:", String(error).slice(0, 200));
  await browser.close();
  process.exit(1);
}
