/**
 * PROBE (not a regression check): the live geometry of chat-view against the
 * built bundle, for four owner-reported questions:
 *
 *   dialog-under-finger - a newly opened extension dialog must not move the
 *     transcript while a pointer is held down (ScrollFollowGate applies the
 *     alignment on release instead). Reports the target's shift while held.
 *   ask-under-finger    - the same contract for a newly opened ask-user form.
 *   drawer-hold         - a notification arriving while a finger rests on the
 *     notifications drawer must not move the card under it until release.
 *   bottom-gap          - the gap from the last message's bottom edge to the
 *     activity dock, when scrolled to the end, plus the chat's bottom padding
 *     that produces it.
 *   pill-heights        - the idle pill's height next to the background-run
 *     pill's height, with the computed font/line-height that explains it.
 *
 * Usage: node scripts/probe-chatview-press-geometry.mjs
 */
import { chromium } from "@playwright/test";

const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const SCREENS = [
  { name: "coarse 393x850", viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true },
  { name: "fine 1440x900", viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false },
];
/** Long enough to cover the rAF alignment and the TOUCH_SETTLE_MS catch-up. */
const SETTLE_WAIT = 700;

const PAGE = (entry) => `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  html,body{margin:0;background:#111;color:#eee;font:14px system-ui,sans-serif}
  /* The tokens the components read through shadow roots; without them every
     var()-based declaration is invalid and the geometry collapses to zero. */
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
    const message = (i) => ({ role: i % 2 === 0 ? "user" : "assistant", parts: [{ type: "text", text: "Probe message " + i + ". " + "filler text to give the line some width ".repeat(2) }] });
    view.sessionId = "probe-session";
    view.messages = Array.from({ length: 30 }, (_, i) => message(i));
    view.status = { isCompacting: false, isBashRunning: false, isStreaming: false, pendingMessageCount: 0 };
    view.notificationInbox = {
      machineId: "local", sessionId: "probe-session", cwd: "/tmp/probe", daemonInstanceId: "probe",
      notifications: Array.from({ length: 4 }, (_, i) => ({ id: "n" + i, message: "Settled notification " + i, truncated: false, severity: "info", receivedAt: "2026-08-29T10:0" + i + ":00.000Z", order: 100 - i })),
      retainedCount: 4, discardedCount: 0, dismissThrough: { order: 0, overflowWatermark: 0 },
      pendingDismissedIds: new Set(), dismissAllPending: false, announcements: [],
    };
    view.onDismissNotification = () => {};
    view.onAnswerDialog = () => {};
    view.onCancelDialog = () => {};
    window.__view = view;
    window.__ready = true;
  </script>
</body></html>`;

/** Press and release helpers: the component listens for these exact events. */
const PRESS = (selector) => {
  const view = window.__view;
  const el = view.renderRoot.querySelector(selector);
  if (el === null) return "missing " + selector;
  for (const type of ["pointerdown", "touchstart"]) el.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
  return "pressed";
};
const RELEASE = (selector) => {
  const view = window.__view;
  const el = view.renderRoot.querySelector(selector);
  if (el === null) return "missing " + selector;
  for (const type of ["pointerup", "pointercancel", "touchend", "touchcancel"]) el.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
  return "released";
};

/** Scroll the transcript to its end and report the bottom-block geometry. */
const SCROLL_TO_END = () => {
  const view = window.__view;
  const chat = view.renderRoot.querySelector(".chat");
  chat.scrollTop = chat.scrollHeight;
  const blocks = chat.querySelectorAll(".msg");
  const last = blocks[blocks.length - 1];
  const rect = last.getBoundingClientRect();
  return { scrollTop: Math.round(chat.scrollTop), maxScroll: Math.round(chat.scrollHeight - chat.clientHeight), lastBottom: Math.round(rect.bottom) };
};

const TARGET_STATE = () => {
  const view = window.__view;
  const chat = view.renderRoot.querySelector(".chat");
  const blocks = chat.querySelectorAll(".msg");
  const last = blocks[blocks.length - 1];
  const rect = last.getBoundingClientRect();
  const card = view.renderRoot.querySelector(".chat > extension-dialog-card.open-dialog-card, .chat > ask-user-card");
  return {
    scrollTop: Math.round(chat.scrollTop),
    targetTop: Math.round(rect.top),
    cardTop: card === null ? undefined : Math.round(card.getBoundingClientRect().top),
    chatTop: Math.round(chat.getBoundingClientRect().top),
  };
};

const NEW_DIALOG = () => {
  window.__view.pendingDialogs = [{
    dialogId: "probe-dialog-1", kind: "select", title: "Deploy where?", askedAt: "2026-08-29T10:00:00.000Z", runScoped: false,
    options: ["Staging", "Production", "Canary", "Abort"],
  }];
};

const NEW_ASK = () => {
  window.__view.pendingAsk = {
    askId: "probe-ask-1", askedAt: "2026-08-29T10:00:00.000Z",
    questions: [{ id: "q1", question: "Proceed with the deploy?", options: [{ value: "yes" }, { value: "no" }] }],
  };
};

/** A fifth notification arrives while the finger is down: newest first, so it prepends. */
const ARRIVE_NOTIFICATION = () => {
  const view = window.__view;
  const previous = view.notificationInbox;
  view.notificationInbox = {
    ...previous,
    notifications: [{ id: "n-new", message: "A live event just arrived while you were reading", truncated: false, severity: "info", receivedAt: "2026-08-29T10:05:00.000Z", order: 200 }, ...previous.notifications],
    retainedCount: previous.retainedCount + 1,
  };
};

const DRAWER_TARGET_STATE = () => {
  const view = window.__view;
  const list = view.renderRoot.querySelector(".notification-list");
  if (list === null) return { missing: "notification list" };
  const rows = list.querySelectorAll("[data-notification-id]");
  // A settled row named by its id, not by position: the arrival prepends a row,
  // so a positional pick would silently measure a different card.
  const settled = list.querySelector("[data-notification-id='n1']");
  if (settled === null) return { missing: "settled row", rows: rows.length };
  const rect = settled.getBoundingClientRect();
  return { rows: rows.length, targetTop: Math.round(rect.top), listScrollTop: Math.round(list.scrollTop) };
};

const DOCK_GEOMETRY = () => {
  const view = window.__view;
  const root = view.renderRoot;
  const chat = root.querySelector(".chat");
  const dock = root.querySelector(".activity-dock");
  if (dock === null) return { missing: "dock" };
  const blocks = chat.querySelectorAll(".msg");
  const last = blocks[blocks.length - 1];
  const chatStyle = getComputedStyle(chat);
  const dockStyle = getComputedStyle(dock);
  return {
    gap: Math.round(dock.getBoundingClientRect().top - last.getBoundingClientRect().bottom),
    chatPaddingBottom: chatStyle.paddingBottom,
    dockMarginTop: dockStyle.marginTop,
    dockHeight: Math.round(dock.getBoundingClientRect().height),
  };
};

const PILL_GEOMETRY = () => {
  const view = window.__view;
  const dock = view.renderRoot.querySelector(".activity-dock");
  if (dock === null) return { missing: "dock" };
  const style = getComputedStyle(dock);
  const text = dock.querySelector(".activity-text");
  return {
    tag: dock.tagName.toLowerCase(),
    classes: dock.className,
    height: Math.round(dock.getBoundingClientRect().height * 10) / 10,
    fontSize: style.fontSize,
    lineHeight: style.lineHeight,
    paddingTop: style.paddingTop,
    paddingBottom: style.paddingBottom,
    minHeight: style.minHeight,
    textLineHeight: text === null ? undefined : getComputedStyle(text).lineHeight,
  };
};

async function pressHoldScenario(page, label, pressSelector, mutate, settleSelector) {
  const before = await page.evaluate(SCROLL_TO_END);
  await page.waitForTimeout(200);
  const rest = await page.evaluate(TARGET_STATE);
  await page.evaluate(PRESS, pressSelector);
  await page.evaluate(mutate);
  await page.waitForTimeout(450);
  const held = await page.evaluate(TARGET_STATE);
  await page.evaluate(RELEASE, pressSelector);
  await page.waitForTimeout(SETTLE_WAIT);
  const after = await page.evaluate(TARGET_STATE);
  const shift = held.targetTop - rest.targetTop;
  console.log(`${label} rest  : ${JSON.stringify(rest)}`);
  console.log(`${label} held  : ${JSON.stringify(held)} targetShift=${String(shift)}px`);
  console.log(`${label} after : ${JSON.stringify(after)}`);
  if (settleSelector !== undefined) {
    const settled = await page.evaluate(TARGET_STATE);
    void settled;
  }
  return { rest, held, after, shift };
}

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

    for (const screen of SCREENS) {
      const context = await browser.newContext({ viewport: screen.viewport, hasTouch: screen.hasTouch, isMobile: screen.isMobile });
      const page = await context.newPage();
      await page.route("**/probe.html", (route) => {
        route.fulfill({ status: 200, contentType: "text/html", body: PAGE(entryUrl) });
      });
      await page.goto("http://127.0.0.1:8505/probe.html", { waitUntil: "networkidle" });
      await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 15000 });
      await page.waitForTimeout(800);

      console.log(`\n=== ${screen.name} ===`);

      // --- dialog alignment under a held finger ---
      const dialog = await pressHoldScenario(page, "dialog", ".chat", NEW_DIALOG);
      const dialogHeldShift = dialog.held.targetTop - dialog.rest.targetTop;
      const dialogCardAligned = dialog.after.cardTop !== undefined && Math.abs(dialog.after.cardTop - dialog.after.chatTop) <= 2;
      console.log(`dialog RESULT: while held shift=${String(dialogHeldShift)}px (0 wanted); after release card aligned to chat top=${String(dialogCardAligned)}`);
      await page.evaluate(() => { window.__view.pendingDialogs = []; });
      await page.waitForTimeout(300);

      // --- ask alignment under a held finger ---
      const ask = await pressHoldScenario(page, "ask", ".chat", NEW_ASK);
      const askHeldShift = ask.held.targetTop - ask.rest.targetTop;
      const askCardAligned = ask.after.cardTop !== undefined && Math.abs(ask.after.cardTop - ask.after.chatTop) <= 2;
      console.log(`ask RESULT: while held shift=${String(askHeldShift)}px (0 wanted); after release card aligned to chat top=${String(askCardAligned)}`);
      await page.evaluate(() => { window.__view.pendingAsk = undefined; });
      await page.waitForTimeout(300);

      // --- notifications drawer under a held finger ---
      const expanded = await page.evaluate(() => {
        const toggle = window.__view.renderRoot.querySelector(".drawer-toggle");
        if (toggle !== null && toggle.getAttribute("aria-expanded") === "false") { toggle.click(); return "expanded"; }
        return toggle === null ? "no-toggle" : "already-open";
      });
      await page.waitForTimeout(300);
      const drawerRest = await page.evaluate(DRAWER_TARGET_STATE);
      if (drawerRest.missing !== undefined) {
        console.log(`drawer FAIL: ${drawerRest.missing} (toggle: ${expanded})`);
        process.exitCode = 1;
        return;
      }
      await page.evaluate(PRESS, ".notification-list");
      await page.evaluate(ARRIVE_NOTIFICATION);
      await page.waitForTimeout(450);
      const drawerHeld = await page.evaluate(DRAWER_TARGET_STATE);
      await page.evaluate(RELEASE, ".notification-list");
      await page.waitForTimeout(SETTLE_WAIT);
      const drawerAfter = await page.evaluate(DRAWER_TARGET_STATE);
      console.log(`drawer rest  : ${JSON.stringify(drawerRest)}`);
      console.log(`drawer held  : ${JSON.stringify(drawerHeld)} targetShift=${String(drawerHeld.targetTop - drawerRest.targetTop)}px`);
      console.log(`drawer after : ${JSON.stringify(drawerAfter)} targetShift=${String(drawerAfter.targetTop - drawerRest.targetTop)}px`);
      await page.evaluate(RELEASE, ".notification-list");

      // --- bottom gap at the end of the transcript ---
      const end = await page.evaluate(SCROLL_TO_END);
      await page.waitForTimeout(200);
      const dock = await page.evaluate(DOCK_GEOMETRY);
      console.log(`bottom-gap   : ${JSON.stringify(dock)} (scrolled to ${String(end.scrollTop)} of ${String(end.maxScroll)})`);

      // --- idle pill vs background-run pill ---
      const idle = await page.evaluate(PILL_GEOMETRY);
      await page.evaluate(() => {
        window.__view.subagentRuns = [{ id: "run-1", agent: "explore", status: "running", startedAt: "2026-08-29T10:00:00.000Z", elapsedMs: 42000, cwd: "/tmp/probe" }];
      });
      await page.waitForTimeout(300);
      const background = await page.evaluate(PILL_GEOMETRY);
      await page.evaluate(() => { window.__view.subagentRuns = []; });
      console.log(`pill idle      : ${JSON.stringify(idle)}`);
      console.log(`pill background: ${JSON.stringify(background)}`);
      console.log(`pill RESULT: idle=${String(idle.height)}px background=${String(background.height)}px difference=${String(Math.round((background.height - idle.height) * 10) / 10)}px`);

      await context.close();
    }
  } finally {
    await browser.close();
  }
}

await main();
