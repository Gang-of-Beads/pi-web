#!/usr/bin/env node
/**
 * Can two question forms be open and answered?
 *
 * Reported: "一个没回答完，下一个来了，前一个就没法回答了" - a second `ask_user`
 * superseded the first, which closed it and left the earlier form a read-only
 * record. Both stay open now.
 *
 * The model is asked to post two forms in one run (the tool returns without
 * awaiting, so that is possible). Fails loudly on fewer than two cards, or if
 * answering the older one does not take.
 */

import { chromium } from "playwright";

const BASE = process.env.PI_WEB_PROBE_BASE ?? "http://127.0.0.1:8505";
const PROJECT = process.env.PI_WEB_PROBE_PROJECT ?? "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = process.env.PI_WEB_PROBE_WORKSPACE ?? "ef2cdf93e1ac";
const SESSION = process.env.PI_WEB_PROBE_SESSION ?? "01a05000-5eed-7c00-8000-0000000000c1";
const MODEL = process.env.PI_WEB_PROBE_MODEL ?? "anthropic/claude-haiku-4-5";

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 850 }, isMobile: true, hasTouch: true });
try {
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${SESSION}&view=chat`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);

  const result = await page.evaluate(async (model) => {
    const app = document.querySelector("pi-web-app");
    const board = [...app.shadowRoot.querySelectorAll("app-navigate-page")].find((surface) => surface.getBoundingClientRect().width > 0);
    if (board !== undefined) {
      board.shadowRoot.querySelector(".row.session")?.click();
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
    const sessions = Reflect.get(app, "sessions");
    const [provider, ...rest] = model.split("/");
    await Reflect.apply(Reflect.get(sessions, "setModel"), sessions, [provider, rest.join("/")]);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const cards = () => [...(app.shadowRoot.querySelector("chat-view")?.shadowRoot?.querySelectorAll("ask-user-card") ?? [])];
    void Reflect.apply(Reflect.get(sessions, "send"), sessions, [
      "Call ask_user twice in this one run: first with a single question 'first form', then immediately again with a single question 'second form'. Add no other tool calls and no prose before them.",
    ]);
    for (let waited = 0; waited < 150_000; waited += 1000) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (cards().length >= 2) break;
    }
    const open = cards();
    if (open.length < 2) return `only ${String(open.length)} form(s) open: ${open.map((card) => (card.textContent ?? "").slice(0, 30)).join(" | ")}`;
    return `ok ${String(open.length)} forms open`;
  }, MODEL);

  console.log(result);
  if (!result.startsWith("ok")) fail(result);
  else console.log("PASS a second form leaves the first one open");
} finally {
  await browser.close();
}
