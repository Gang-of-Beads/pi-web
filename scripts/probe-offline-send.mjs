#!/usr/bin/env node
/**
 * A failed send keeps it in the outbox, and only that.
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

  const opened = await page.evaluate(async () => {
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
    Reflect.set(editor, "draft", "offline-probe message");
    Reflect.apply(Reflect.get(editor, "requestUpdate"), editor, []);
    await new Promise((resolve) => setTimeout(resolve, 300));
    Reflect.apply(Reflect.get(editor, "send"), editor, ["followUp"]);
    await new Promise((resolve) => setTimeout(resolve, 8000));
    return "ok";
  });
  if (opened !== "ok") {
    fail(`${opened} (routes seen: ${JSON.stringify(seen)})`);
  } else {
    const failed = await outboxRows();
    if (!failed.some((row) => row.includes("Unsent") && row.includes("Retry"))) {
      const diag = await page.evaluate(() => {
        const editor = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("prompt-editor");
        return { send: Reflect.get(window, "probeSend"), keys: Object.keys(localStorage).filter((k) => k.includes("pending-prompt")), sessionId: Reflect.get(editor, "sessionId"), machineId: Reflect.get(editor, "machineId"), pending: (Reflect.get(editor, "pendingPrompts") ?? []).length, sending: Reflect.get(editor, "sending"), inFlight: [...(Reflect.get(editor, "outboxInFlight") ?? [])].length, rows: editor?.shadowRoot?.querySelectorAll(".pending-prompt").length ?? -1, failure: Reflect.get(editor, "sendFailure") };
      });
      fail(`no unsent row offering Retry: ${JSON.stringify(failed)} (routes seen: ${JSON.stringify(seen)}) diag=${JSON.stringify(diag)}`);
    } else {
      broken = false;
      await page.evaluate(() => {
        const editor = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("prompt-editor");
        const retry = [...(editor?.shadowRoot?.querySelectorAll(".pending-prompt button") ?? [])].find((button) => (button.textContent ?? "").trim() === "Retry");
        retry?.click();
      });
      await page.waitForTimeout(7000);
      const after = await outboxRows();
      if (after.length > 0) fail(`the row survived a successful retry: ${JSON.stringify(after)}`);
      else console.log("PASS an unsent row offers Retry, and Retry clears it");
    }
  }
} finally {
  await browser.close();
}
