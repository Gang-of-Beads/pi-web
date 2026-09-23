#!/usr/bin/env node
/**
 * Does a slash command stay where it was issued?
 *
 * Owner report: "为啥这个slash消息一直在这" - a `/goal` that started the turn was
 * drawn in the transcript tail, under the reply it caused, where it read as
 * something still pending. The row is a message: it belongs at the moment it
 * was issued. Fails loudly if it is still sitting after the later message.
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

  const result = await page.evaluate(async () => {
    const app = document.querySelector("pi-web-app");
    const board = [...app.shadowRoot.querySelectorAll("app-navigate-page")].find((surface) => surface.getBoundingClientRect().width > 0);
    if (board !== undefined) {
      board.shadowRoot.querySelector(".row.session")?.click();
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
    const sessions = Reflect.get(app, "sessions");
    const send = Reflect.get(sessions, "send");
    const marker = `after-command-${String(Date.now())}`;
    void Reflect.apply(send, sessions, ["/copy"]);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    void Reflect.apply(send, sessions, [marker]);
    await new Promise((resolve) => setTimeout(resolve, 6000));

    const root = app.shadowRoot.querySelector("chat-view")?.shadowRoot;
    if (root === undefined) return "no chat view";
    const rows = [...root.querySelectorAll(".chat > *")];
    const commandIndex = rows.findIndex((row) => row.classList?.contains("command"));
    // A user bubble's body lives several shadow roots deep, which textContent
    // of the parent does not reach.
    const textOf = (node) => {
      let text = node.textContent ?? "";
      if (node.shadowRoot !== null && node.shadowRoot !== undefined) text += textOf(node.shadowRoot);
      for (const child of node.children ?? []) text += textOf(child);
      return text;
    };
    const markerIndex = rows.findIndex((row) => textOf(row).includes(marker));
    const commandText = commandIndex === -1 ? "" : (rows[commandIndex].textContent ?? "").replace(/\s+/gu, " ").trim().slice(0, 40);
    if (commandIndex === -1) return "no command row in the transcript";
    if (markerIndex === -1) return `the message after the command never rendered (command at ${String(commandIndex)}; tail: ${rows.slice(-4).map((row) => (row.textContent ?? "").replace(/\s+/gu, " ").trim().slice(0, 40)).join(" | ")})`;
    return commandIndex < markerIndex
      ? `ok index ${String(commandIndex)} < ${String(markerIndex)} "${commandText}"`
      : `command at ${String(commandIndex)} is NOT before the later message at ${String(markerIndex)}`;
  });

  console.log(result);
  if (!result.startsWith("ok")) fail(result);
  else console.log("PASS the command bubble stays where it was issued");
} finally {
  await browser.close();
}
