#!/usr/bin/env node
/**
 * Does the transcript hold still while an answer streams above a queued
 * message?
 *
 * The owner's report, exactly: with a message queued at the bottom, every
 * streamed chunk pushed the queued bubble down and the view snapped back - a
 * bounce per chunk. Growth during streaming happens inside child components,
 * after the transcript's own render has finished, so nothing re-pins the
 * bottom until the next parent update.
 *
 * This drives a real turn on the 8505 stack, queues a second message under it,
 * and samples the scroller's distance from its own bottom every animation
 * frame. Fails loudly: no turn, no queued row, or any frame that drifts.
 */

import { chromium } from "playwright";

const BASE = process.env.PI_WEB_PROBE_BASE ?? "http://127.0.0.1:8505";
const PROJECT = process.env.PI_WEB_PROBE_PROJECT ?? "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = process.env.PI_WEB_PROBE_WORKSPACE ?? "ef2cdf93e1ac";
const SESSION = process.env.PI_WEB_PROBE_SESSION ?? "01a05000-5eed-7c00-8000-0000000000c1";
/** The seed session's own model can be slow or rate limited; the bug under
 * test is about layout, not about which model answers. */
const MODEL = process.env.PI_WEB_PROBE_MODEL ?? "anthropic/claude-haiku-4-5";
const WATCH_MS = Number(process.env.PI_WEB_PROBE_WATCH_MS ?? 25_000);

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 393, height: 850 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  try {
    await page.goto(`${BASE}/?project=${encodeURIComponent(PROJECT)}&workspace=${encodeURIComponent(WORKSPACE)}&session=${encodeURIComponent(SESSION)}&view=chat`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(8000);

    const ready = await page.evaluate(async () => {
      const app = document.querySelector("pi-web-app");
      if (app === null) return "no app";
      const board = [...app.shadowRoot.querySelectorAll("app-navigate-page")].find((surface) => surface.getBoundingClientRect().width > 0);
      if (board !== undefined) {
        board.shadowRoot.querySelector(".row.session")?.click();
        await new Promise((resolve) => setTimeout(resolve, 4000));
      }
      const scroller = app.shadowRoot.querySelector("chat-view")?.shadowRoot?.querySelector(".chat");
      return scroller === null || scroller === undefined || scroller.clientHeight === 0 ? "transcript is not on screen" : "ok";
    });
    if (ready !== "ok") {
      fail(`could not put a transcript on screen: ${ready}`);
      return;
    }

    const started = await page.evaluate(async (model) => {
      const app = document.querySelector("pi-web-app");
      const sessions = Reflect.get(app, "sessions");
      const send = typeof sessions === "object" && sessions !== null ? Reflect.get(sessions, "send") : undefined;
      if (typeof send !== "function") return "no send entry point";
      // A long answer, then a second message that must queue behind it.
      const [provider, ...rest] = model.split("/");
      const setModel = Reflect.get(sessions, "setModel");
      if (typeof setModel === "function") {
        await Reflect.apply(setModel, sessions, [provider, rest.join("/")]);
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      // The dock's wording moves between "agent running" and "receiving
      // response" depending on phase; either means the turn is live.
      const live = () => /receiving response|agent running/u.test(app.shadowRoot.querySelector("chat-view")?.shadowRoot?.textContent ?? "");
      const queuedNow = () => app.shadowRoot.querySelector("chat-view")?.shadowRoot?.textContent?.includes("Queued") === true;
      // A queue only forms while a turn is actually running, and how long the
      // model takes is not under this probe's control: ask for a long answer,
      // wait for it to be live, then offer follow-ups until one is queued.
      void Reflect.apply(send, sessions, ["Count slowly from 1 to 200, one number per line, nothing else."]);
      for (let waited = 0; waited < 90_000 && !live(); waited += 500) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!live()) return "the turn never started streaming";
      for (let attempt = 0; attempt < 8 && !queuedNow(); attempt += 1) {
        void Reflect.apply(send, sessions, [`This one waits its turn (${String(attempt)}).`]);
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      const view = app.shadowRoot.querySelector("chat-view");
      const queued = queuedNow();
      const scroller = view?.shadowRoot?.querySelector(".chat");
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      const tail = (view?.shadowRoot?.textContent ?? "").replace(/\s+/gu, " ").slice(-400);
      return queued ? "ok" : `no queued row · transcript tail: ${tail}`;
    }, MODEL);
    if (started !== "ok") {
      fail(`could not reach the reported state: ${started}`);
      return;
    }

    const record = await page.evaluate(async (watchMs) => {
      const app = document.querySelector("pi-web-app");
      const scroller = app.shadowRoot.querySelector("chat-view").shadowRoot.querySelector(".chat");
      const samples = [];
      const deadline = Date.now() + watchMs;
      await new Promise((resolve) => {
        const tick = () => {
          samples.push({
            distance: Math.round(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight),
            height: Math.round(scroller.scrollHeight),
          });
          if (Date.now() >= deadline) { resolve(undefined); return; }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return { samples, grew: samples[samples.length - 1].height - samples[0].height };
    }, WATCH_MS);

    const distances = record.samples.map((sample) => sample.distance);
    const worst = Math.max(...distances);
    const displaced = distances.filter((distance) => distance > 2).length;
    console.log(`frames ${String(distances.length)} · transcript grew ${String(record.grew)}px`);
    console.log(`worst distance from the bottom ${String(worst)}px · frames displaced ${String(displaced)}`);
    if (record.grew < 50) {
      fail("the transcript did not grow, so nothing was under test");
      return;
    }
    if (worst > 2) {
      fail(`the queued row was pushed off the bottom while the answer streamed (worst ${String(worst)}px, ${String(displaced)} frames)`);
      return;
    }
    console.log("PASS the bottom held through the whole stream");
  } finally {
    await browser.close();
  }
}

await main();
