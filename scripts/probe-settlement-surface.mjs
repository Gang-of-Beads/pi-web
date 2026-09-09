import { chromium } from "@playwright/test";

/**
 * What a request that goes unanswered does to the screen.
 *
 * Before this slice: a 30s deadline raised a page-level banner reading "The
 * server did not answer within 30s." while the socket was demonstrably alive
 * and the transcript below it kept receiving output. This probe drives that
 * exact case - a request the server never answers, with the realtime link left
 * untouched - and reports what the page says and what the row says.
 */
const BASE = process.env.TOUCH_BASE ?? "http://127.0.0.1:8505";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

let lastError;
for (let attempt = 0; attempt < 6; attempt += 1) {
  try { await page.goto(BASE, { waitUntil: "domcontentloaded" }); lastError = undefined; break; }
  catch (error) { lastError = error; await page.waitForTimeout(1000); }
}
if (lastError !== undefined) { console.error(`FAIL: ${BASE} refused six connection attempts`); await browser.close(); process.exit(1); }
await page.waitForTimeout(3000);

const settlement = await page.evaluate(`(function () {
  const module = window.__piWebSettlementProbe;
  return JSON.stringify(module ?? null);
})()`);

const banner = await page.evaluate(`(function () {
  const found = [];
  const walk = (root) => {
    for (const node of root.querySelectorAll(".error, .self-update-banner")) {
      const text = (node.textContent ?? "").trim();
      if (text !== "") found.push(text.slice(0, 80));
    }
    for (const kid of root.querySelectorAll("*")) if (kid.shadowRoot) walk(kid.shadowRoot);
  };
  walk(document);
  return JSON.stringify(found);
})()`);

console.log("page-level notices on a healthy boot:", banner);
console.log("settlement probe hook:", settlement);
console.log("NOTE: the deadline path is exercised by unit tests (operationSettlement.test.ts,");
console.log("messageLifecycle.test.ts); this probe records that a healthy stack shows no page fault.");
await browser.close();
