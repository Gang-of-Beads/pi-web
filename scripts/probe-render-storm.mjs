#!/usr/bin/env node
/**
 * How much work the idle app does, and how many times it asks for pins.
 *
 * Report: "感觉越来越多bug了" / "总是回弹". Measured root cause: pinnedSessionIdsFor
 * runs while rendering, and every read it started ended in a render that asked
 * again - 7,127 requests to /api/session-pins in five seconds, 1,425 a second,
 * with the whole app re-rendering just as often. On v2.202609.11 (before the
 * fix) idle at 393x850: ~4,500 app renders per three seconds. Fails loudly when
 * the loop comes back.
 */
import { chromium } from "playwright";

const BASE = process.env.PI_WEB_PROBE_BASE ?? "http://127.0.0.1:8505";
const IDLE_BUDGET = Number(process.env.PI_WEB_PROBE_IDLE_BUDGET ?? 200);
const PIN_BUDGET = Number(process.env.PI_WEB_PROBE_PIN_BUDGET ?? 20);

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 850 }, isMobile: true, hasTouch: true });
try {
  await page.goto(`${BASE}/?project=991606fd-e498-4b93-a1ce-2af09efdb0e7&workspace=ef2cdf93e1ac&session=01a05000-5eed-7c00-8000-0000000000c1&view=chat`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);
  const out = await page.evaluate(async ([idleMs]) => {
    const app = document.querySelector("pi-web-app");
    const board = [...app.shadowRoot.querySelectorAll("app-navigate-page")].find((surface) => surface.getBoundingClientRect().width > 0);
    if (board !== undefined) {
      board.shadowRoot.querySelector(".row.session")?.click();
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
    let pins = 0;
    let renders = 0;
    const realFetch = window.fetch;
    window.fetch = function wrapped(input, init) {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      if (url.includes("session-pins")) pins += 1;
      return realFetch.call(this, input, init);
    };
    const original = app.render;
    Reflect.set(app, "render", function counted(...args) { renders += 1; return Reflect.apply(original, this, args); });
    await new Promise((resolve) => setTimeout(resolve, idleMs));
    return { renders, pins, ms: idleMs };
  }, [3000]);

  const perSecond = Math.round((out.renders / out.ms) * 1000);
  console.log(`idle: ${String(out.renders)} renders in ${String(out.ms)}ms (${String(perSecond)}/s), ${String(out.pins)} pin reads`);
  if (out.renders > IDLE_BUDGET) fail(`an idle app rendered ${String(out.renders)} times (budget ${String(IDLE_BUDGET)})`);
  else if (out.pins > PIN_BUDGET) fail(`an idle app read pins ${String(out.pins)} times (budget ${String(PIN_BUDGET)})`);
  else console.log("PASS the idle app is quiet");
} finally {
  await browser.close();
}
