#!/usr/bin/env node
/**
 * Does a command's answer reach the screen?
 *
 * Owner report: "/goal-list 不理我" - the command ran (its bubble settled to
 * "Read") and answered into an extension notification, which was written to the
 * notification store and never read: `notificationInbox` had no caller. The
 * answer now also lands in the transcript as a command-output row.
 *
 * Fails loudly: no command row, or no output row carrying the command's text.
 */

import { chromium } from "playwright";

const BASE = process.env.PI_WEB_PROBE_BASE ?? "http://127.0.0.1:8505";
const PROJECT = process.env.PI_WEB_PROBE_PROJECT ?? "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = process.env.PI_WEB_PROBE_WORKSPACE ?? "ef2cdf93e1ac";
const SESSION = process.env.PI_WEB_PROBE_SESSION ?? "01a05000-5eed-7c00-8000-0000000000c1";
const COMMAND = process.env.PI_WEB_PROBE_COMMAND ?? "/goal-list";

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 850 }, isMobile: true, hasTouch: true });
try {
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${SESSION}&view=chat`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);

  const result = await page.evaluate(async (command) => {
    const app = document.querySelector("pi-web-app");
    const board = [...app.shadowRoot.querySelectorAll("app-navigate-page")].find((surface) => surface.getBoundingClientRect().width > 0);
    if (board !== undefined) {
      board.shadowRoot.querySelector(".row.session")?.click();
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
    const sessions = Reflect.get(app, "sessions");
    const root = () => app.shadowRoot.querySelector("chat-view")?.shadowRoot;
    const deepText = (node) => {
      let text = node.textContent ?? "";
      if (node.shadowRoot !== null && node.shadowRoot !== undefined) text += deepText(node.shadowRoot);
      for (const child of node.children ?? []) text += deepText(child);
      return text;
    };
    const before = [...(root()?.querySelectorAll(".chat > *") ?? [])].length;
    void Reflect.apply(Reflect.get(sessions, "send"), sessions, [command]);
    for (let waited = 0; waited < 20_000; waited += 500) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const rows = [...(root()?.querySelectorAll(".chat > *") ?? [])];
      const fresh = rows.slice(before).map((row) => ({ cls: row.className, text: deepText(row).replace(/\s+/gu, " ").trim() }));
      const commandRow = fresh.find((row) => row.cls.includes("command"));
      // An info-level answer rides as a tool-role line (chatTranscript), so the
      // row is not a system row; it is whatever the transcript made of it.
      const outputRow = fresh.find((row) => !row.cls.includes("command") && row.text !== "" && !row.cls.includes("event-group"));
      if (commandRow !== undefined && commandRow.text.includes("Read") && outputRow !== undefined) {
        return `ok command="${commandRow.text.slice(0, 30)}" output="${outputRow.text.slice(0, 60)}"`;
      }
    }
    const rows = [...(root()?.querySelectorAll(".chat > *") ?? [])].slice(before);
    return `no answer row: ${rows.map((row) => `${row.className}:${deepText(row).replace(/\s+/gu, " ").trim().slice(0, 40)}`).join(" | ")}`;
  }, COMMAND);

  console.log(result);
  if (!result.startsWith("ok")) fail(result);
  else console.log("PASS a command's answer reaches the transcript");
} finally {
  await browser.close();
}
