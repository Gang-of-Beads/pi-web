/**
 * PROBE (one-off): where does the residual ask-open movement under a held
 * finger come from? Measured 2026-08-29 against the built bundle at 393x850:
 * with the press held, the ask opens and the transcript shifts DOWN 19px
 * (scrollTop 2334 -> 2315, last message top 698 -> 717) and holds there; the
 * gate refused every component scroll (the no-press run shows the deferred
 * alignment instead: 2334 -> 2577). The dialog and the notifications drawer
 * hold at exactly 0px under the same conditions. 19px is well under the
 * 236-330px the press gate removed, but it is not zero; the working hypothesis
 * is a transient scroll-range clamp while the dock is removed and the ask card
 * renders (forced reflow inside publishDockRoom/publishScrollbarWidth), which
 * needs its own measurement rig to prove. This script reproduces the number.
 *
 * Usage: node scripts/probe-ask-held-shift.mjs [--no-press]
 */
import { chromium } from "@playwright/test";

const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const SCREEN = { width: 393, height: 850 };

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
    --pi-control-height:32px;--pi-control-height-touch:44px;--pi-motion-fast:120ms;--pi-motion-base:180ms;
  }
  chat-view{height:100vh}
</style></head><body>
  <chat-view id="view"></chat-view>
  <script type="module">
    import "${entry}";
    const view = document.getElementById("view");
    view.sessionId = "probe-session";
    view.messages = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", parts: [{ type: "text", text: "Probe message " + i + ". " + "filler text to give the line some width ".repeat(2) }] }));
    view.status = { isCompacting: false, isBashRunning: false, isStreaming: false, pendingMessageCount: 0 };
    window.__view = view;
    window.__ready = true;
  </script>
</body></html>`;

const STATE = () => {
  const view = window.__view;
  const root = view.renderRoot;
  const chat = root.querySelector(".chat");
  const dock = root.querySelector(".activity-dock");
  const blocks = chat.querySelectorAll(".msg");
  const last = blocks[blocks.length - 1];
  const ask = root.querySelector("ask-user-card");
  return {
    scrollTop: Math.round(chat.scrollTop),
    chatTop: Math.round(chat.getBoundingClientRect().top),
    chatHeight: Math.round(chat.getBoundingClientRect().height),
    chatWrapTop: Math.round(root.querySelector(".chat-wrap").getBoundingClientRect().top),
    lastTop: Math.round(last.getBoundingClientRect().top),
    dockTop: dock === null ? null : Math.round(dock.getBoundingClientRect().top),
    askTop: ask === null ? null : Math.round(ask.getBoundingClientRect().top),
    askHeight: ask === null ? null : Math.round(ask.getBoundingClientRect().height),
  };
};

const OPEN_ASK = () => {
  window.__view.pendingAsk = {
    askId: "probe-ask-1", askedAt: "2026-08-29T10:00:00.000Z",
    questions: [{ id: "q1", question: "Proceed?", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] }],
  };
};

async function main() {
  const browser = await chromium.launch({ executablePath: EXE });
  try {
    const context = await browser.newContext({ viewport: SCREEN, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    const index = await (await fetch("http://127.0.0.1:8505/")).text();
    const entry = /src="([^"]*index-[^"]*\.js)"/u.exec(index)?.[1];
    const entryUrl = `/${entry.replace(/^\.?\//u, "")}`;
    await page.route("**/probe.html", (route) => {
      route.fulfill({ status: 200, contentType: "text/html", body: PAGE(entryUrl) });
    });
    await page.goto("http://127.0.0.1:8505/probe.html", { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 15000 });
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      const chat = window.__view.renderRoot.querySelector(".chat");
      chat.scrollTop = chat.scrollHeight;
    });
    await page.waitForTimeout(300);
    const rest = await page.evaluate(STATE);
    console.log(`rest : ${JSON.stringify(rest)}`);
    await page.evaluate(() => {
      const chat = window.__view.renderRoot.querySelector(".chat");
      if (!process.env.PROBE_NO_PRESS) for (const type of ["pointerdown", "touchstart"]) chat.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
    });
    await page.evaluate(OPEN_ASK);
    await page.waitForTimeout(500);
    const held = await page.evaluate(STATE);
    console.log(`held : ${JSON.stringify(held)}`);
    await page.waitForTimeout(700);
    const settled = await page.evaluate(STATE);
    console.log(`+700 : ${JSON.stringify(settled)}`);
  } finally {
    await browser.close();
  }
}

await main();
