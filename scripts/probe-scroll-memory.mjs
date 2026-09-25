#!/usr/bin/env node
/**
 * Reopening a session must land where the reader left it.
 *
 * Reported: "有些窗口状态可以记录下…我有时候打开还要滑到最底下" and "总是回弹，给我
 * 弹到很上面". Both are one bug: a reader 40px above the bottom saved an
 * *anchor*, and an anchor that is not in the loaded window sends the restore to
 * the top to page history in - so opening a session flung them far above.
 *
 * Fails loudly: a reader who was near the bottom must land near the bottom, and
 * a reader who was reading in the middle must keep their message.
 */

import { chromium } from "playwright";

const BASE = process.env.PI_WEB_PROBE_BASE ?? "http://127.0.0.1:8505";
const PROJECT = process.env.PI_WEB_PROBE_PROJECT ?? "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = process.env.PI_WEB_PROBE_WORKSPACE ?? "ef2cdf93e1ac";
const SESSION = process.env.PI_WEB_PROBE_SESSION ?? "01a05000-5eed-7c00-8000-0000000000c1";

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 850 }, isMobile: true, hasTouch: true });
try {
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${SESSION}&view=chat`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);

  const out = await page.evaluate(async () => {
    const app = document.querySelector("pi-web-app");
    const board = [...app.shadowRoot.querySelectorAll("app-navigate-page")].find((surface) => surface.getBoundingClientRect().width > 0);
    if (board !== undefined) {
      board.shadowRoot.querySelector(".row.session")?.click();
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    const chat = app.shadowRoot.querySelector("chat-view")?.shadowRoot?.querySelector(".chat");
    if (chat === undefined || chat === null) return "no transcript";
    const sessions = Reflect.get(app, "sessions");
    const distance = () => Math.round(chat.scrollHeight - chat.scrollTop - chat.clientHeight);

    // 40px above the bottom: near enough to be "at the bottom" for a reader,
    // and exactly the band that used to save an anchor instead.
    chat.scrollTop = chat.scrollHeight - chat.clientHeight - 40;
    chat.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => setTimeout(resolve, 800));
    const leftAt = distance();

    // Leave and come back, which is what opening a session does.
    const other = [...app.shadowRoot.querySelectorAll("chat-view")].length;
    Reflect.apply(Reflect.get(sessions, "selectSession"), sessions, [undefined]);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    Reflect.apply(Reflect.get(sessions, "selectSession"), sessions, [Reflect.get(Reflect.get(app, "state"), "sessions")[0]]);
    await new Promise((resolve) => setTimeout(resolve, 6000));

    const nearBottom = { leftAt, other, cameBackAt: distance() };

    // And a reader in the middle keeps their message, which is the anchor path.
    const middle = 2500;
    chat.scrollTop = Math.max(0, chat.scrollHeight - chat.clientHeight - middle);
    chat.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => setTimeout(resolve, 800));
    const topOfMessage = chat.scrollTop;
    Reflect.apply(Reflect.get(sessions, "selectSession"), sessions, [undefined]);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    Reflect.apply(Reflect.get(sessions, "selectSession"), sessions, [Reflect.get(Reflect.get(app, "state"), "sessions")[0]]);
    await new Promise((resolve) => setTimeout(resolve, 6000));
    const middleBack = Math.round(Math.abs(chat.scrollTop - topOfMessage));

    return { ...nearBottom, middleBack, stored: Object.entries(localStorage).filter(([key]) => key.includes("chat-scroll")).map(([, value]) => value) };
  });

  if (typeof out === "string") {
    fail(out);
  } else {
    console.log(`left at ${String(out.leftAt)}px from the bottom, came back at ${String(out.cameBackAt)}px`, out.stored.slice(-1));
    if (out.cameBackAt > 60) fail(`a reader who left near the bottom came back ${String(out.cameBackAt)}px away`);
    else if (out.middleBack > 200) fail(`a reader who left mid-transcript came back ${String(out.middleBack)}px off`);
    else console.log("PASS a session reopens where the reader left it, bottom or mid-transcript");
  }
} finally {
  await browser.close();
}
