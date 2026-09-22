#!/usr/bin/env node
/**
 * Does a queued message ever draw twice?
 *
 * Owner report: each message queued under a streaming turn appeared as two
 * rows - one plain, one badged "Queued" - because the accepted echo carried its
 * minted id on one meta field and the queue carried it on another, so the
 * register that exists to make one row per message keyed them apart.
 *
 * Fails loudly: no turn, no queue, or any repeated text among the user rows.
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
const page = await browser.newPage({ viewport: { width: 393, height: 850 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
try {
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${SESSION}&view=chat`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);

  const started = await page.evaluate(async (model) => {
    const app = document.querySelector("pi-web-app");
    const board = [...app.shadowRoot.querySelectorAll("app-navigate-page")].find((surface) => surface.getBoundingClientRect().width > 0);
    if (board !== undefined) {
      board.shadowRoot.querySelector(".row.session")?.click();
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
    const sessions = Reflect.get(app, "sessions");
    const [provider, ...rest] = model.split("/");
    await Reflect.apply(Reflect.get(sessions, "setModel"), sessions, [provider, rest.join("/")]);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const view = () => app.shadowRoot.querySelector("chat-view")?.shadowRoot;
    void Reflect.apply(Reflect.get(sessions, "send"), sessions, ["Count slowly from 1 to 300, one number per line, nothing else."]);
    for (let waited = 0; waited < 90_000; waited += 500) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if ((view()?.textContent ?? "").includes("receiving response")) break;
    }
    if (!(view()?.textContent ?? "").includes("receiving response")) return "the turn never started streaming";
    const marker = `queued-once-${String(Date.now())}`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      void Reflect.apply(Reflect.get(sessions, "send"), sessions, [`${marker} turn ${String(attempt)}`]);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const text = view()?.textContent ?? "";
    if (!text.includes("Queued")) return `no queued row · tail: ${text.replace(/\s+/gu, " ").slice(-200)}`;
    return "ok";
  }, MODEL);
  if (started !== "ok") {
    fail(`could not reach the reported state: ${started}`);
  } else {
    const counts = await page.evaluate(() => {
      const app = document.querySelector("pi-web-app");
      const root = app.shadowRoot.querySelector("chat-view")?.shadowRoot;
      const rows = [...(root?.querySelectorAll(".message.user") ?? [])].map((row) => (row.textContent ?? "").replace(/\s+/gu, " ").trim());
      const tally = new Map();
      for (const text of rows) tally.set(text, (tally.get(text) ?? 0) + 1);
      return [...tally.entries()].filter(([, count]) => count > 1).map(([text, count]) => `${String(count)}x ${text.slice(0, 60)}`);
    });
    console.log(`duplicated user rows: ${counts.length === 0 ? "none" : counts.join(" | ")}`);
    if (counts.length > 0) fail("a queued message drew more than one row");
    else console.log("PASS one row per queued message");
  }
} finally {
  await browser.close();
}
