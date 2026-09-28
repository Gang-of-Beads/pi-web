#!/usr/bin/env node
/**
 * A failed send keeps it in the outbox, and shows it once.
 *
 * Owner report: "已经确认开始处理的消息，还怎么还可能有 retry/discard 呢？有些状态
 * 就不可能一起存在". Retry belongs to a send that stopped; a message still on its
 * way can only be taken back, and one the daemon confirmed leaves the outbox.
 *
 * The prompt request is aborted at the network layer (patching window.fetch is
 * not enough - the api layer may have captured it), then reopened so the Retry
 * button's own send can land.
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
let broken = true;
const MARKER = `offline-probe ${String(Date.now())}`;
try {
  const seen = [];
  await page.route("**/prompt*", (route) => {
    seen.push(route.request().url());
    return broken ? route.abort("failed") : route.continue();
  });
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${SESSION}&view=chat`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);

  const outboxRows = () => page.evaluate(() => {
    const editor = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("prompt-editor");
    return [...(editor?.shadowRoot?.querySelectorAll(".pending-prompt") ?? [])].map((row) => (row.textContent ?? "").replace(/\s+/gu, " ").trim());
  });

  const opened = await page.evaluate(async (marker) => {
    const app = document.querySelector("pi-web-app");
    const board = [...app.shadowRoot.querySelectorAll("app-navigate-page")].find((surface) => surface.getBoundingClientRect().width > 0);
    if (board !== undefined) {
      board.shadowRoot.querySelector(".row.session")?.click();
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
    const editor = app.shadowRoot.querySelector("prompt-editor");
    if (editor === null) return "no composer";
    const original = Reflect.get(editor, "onSend");
    Reflect.set(editor, "onSend", async function (...args) {
      try {
        const result = await Reflect.apply(original, this, args);
        Reflect.set(window, "probeSend", `resolved:${String(result)}`);
        return result;
      } catch (error) {
        Reflect.set(window, "probeSend", `threw:${String(error)}`);
        throw error;
      }
    });
    // Through the composer, not the controller: only the composer writes the
    // outbox entry this probe is about.
    Reflect.set(editor, "draft", marker);
    Reflect.apply(Reflect.get(editor, "requestUpdate"), editor, []);
    await new Promise((resolve) => setTimeout(resolve, 300));
    Reflect.apply(Reflect.get(editor, "send"), editor, ["followUp"]);
    await new Promise((resolve) => setTimeout(resolve, 8000));
    return "ok";
  }, MARKER);
  const bubbleRows = () => page.evaluate((marker) => {
    const deepText = (node) => {
      let text = node.textContent ?? "";
      for (const child of node.querySelectorAll("*")) {
        if (child.shadowRoot) text += ` ${deepText(child.shadowRoot)}`;
      }
      return text;
    };
    const view = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view");
    return [...(view?.shadowRoot?.querySelectorAll(".msg.user") ?? [])]
      .filter((row) => deepText(row).includes(marker))
      .map((row) => ({
        mark: (row.querySelector(".delivery-mark")?.getAttribute("aria-label") ?? "").trim(),
        actions: [...row.querySelectorAll(".msg-action[data-action]")].map((button) => button.getAttribute("data-action")),
      }));
  }, MARKER);
  if (opened !== "ok") {
    fail(`${opened} (routes seen: ${JSON.stringify(seen)})`);
  } else {
    const tray = await outboxRows();
    const bubbles = await bubbleRows();
    await page.screenshot({ path: "/tmp/offline-one-row.png" });
    console.log("after the failed send:", JSON.stringify({ tray, bubbles }));
    const diag = await page.evaluate(() => {
      const app = document.querySelector("pi-web-app");
      const editor = app?.shadowRoot?.querySelector("prompt-editor");
      const view = app?.shadowRoot?.querySelector("chat-view");
      const state = app?.state;
      const tail = (state?.messages ?? []).slice(-3).map((line) => ({ role: line.role, delivery: line.meta?.delivery, text: JSON.stringify(line.parts).slice(0, 60) }));
      return {
        send: Reflect.get(window, "probeSend"),
        outbox: Object.keys(localStorage).filter((key) => key.includes("pending-prompt")).map((key) => [key, (localStorage.getItem(key) ?? "").slice(0, 160)]),
        selected: state?.selectedSession?.id,
        editorSession: editor === null || editor === undefined ? null : Reflect.get(editor, "sessionId"),
        chatView: view !== null && view !== undefined,
        tail,
        userRows: view?.shadowRoot?.querySelectorAll(".msg.user").length ?? null,
      };
    });
    console.log("diag:", JSON.stringify(diag));
    if (bubbles.length !== 1) fail(`the unsent message has ${String(bubbles.length)} transcript rows, not one`);
    else if (tray.length !== 0) fail(`the composer tray repeats a message the transcript already draws: ${JSON.stringify(tray)}`);
    else if (!bubbles[0].actions.includes("retry") || !bubbles[0].actions.includes("discard")) fail(`the one row does not carry Retry and Discard: ${JSON.stringify(bubbles[0].actions)}`);
    else {
      broken = false;
      await page.evaluate(() => {
        const view = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view");
        const retries = [...(view?.shadowRoot?.querySelectorAll(".msg.user .msg-action[data-action='retry']") ?? [])];
        if (retries.length === 1) retries[0].click();
        Reflect.set(window, "probeRetryButtons", retries.length);
      });
      await page.waitForTimeout(7000);
      const keys = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.includes("pending-prompt")).map((key) => [key, localStorage.getItem(key)]));
      const leftover = keys.filter(([, value]) => value !== null && value.includes(MARKER));
      const afterBubbles = await bubbleRows();
      console.log("after row Retry:", JSON.stringify({ leftover: leftover.length, bubbles: afterBubbles }));
      if (leftover.length > 0) fail("the outbox still holds the message after a successful row Retry");
      else if (afterBubbles.length !== 1) fail(`row Retry left ${String(afterBubbles.length)} rows for one message`);
      else if (afterBubbles[0].actions.includes("retry")) fail("the row still offers Retry after the retry landed");
      else console.log("PASS one row per unsent message; its own Retry lands it and clears the outbox");
    }
  }
} finally {
  await browser.close();
}
