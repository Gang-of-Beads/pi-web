/**
 * Liveness preamble for every browser pass against the live stack (D1).
 *
 * A pass that starts against a dead or half-dead stack produces screenshots
 * and numbers that read as findings but are really outage artifacts. The
 * preamble makes that state loud BEFORE any measuring: it requires
 *   1. the sessions API answering 200, and
 *   2. one seeded session actually opening in a real browser,
 * and exits 2 (FAIL(precondition)) otherwise, printing which leg failed.
 *
 * Usage: node scripts/liveness-preamble.mjs [baseUrl]
 *   default baseUrl: http://127.0.0.1:8505
 * Exit codes: 0 = live, 2 = precondition failed (the pass must abort).
 */
import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "http://127.0.0.1:8505";
const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

async function sessionsApiLive() {
  try {
    const response = await fetch(`${BASE}/api/machines/local/sessions/unread`, { signal: AbortSignal.timeout(5000) });
    return response.status === 200;
  } catch {
    return false;
  }
}

async function seededSessionOpens() {
  let browser;
  try {
    browser = await chromium.launch({ executablePath: EXE, headless: true });
    const page = await browser.newPage({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
    const response = await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 15_000 });
    if (response === null || !response.ok()) return false;
    await page.waitForSelector("pi-web-app, [class]", { timeout: 15_000 });
    const title = await page.title();
    return typeof title === "string" && title.length > 0;
  } catch {
    return false;
  } finally {
    if (browser !== undefined) await browser.close().catch(() => undefined);
  }
}

const api = await sessionsApiLive();
console.log(`liveness: sessions API ${api ? "200" : "unreachable"}`);
if (!api) {
  console.log("FAIL(precondition): sessions API is not answering 200 - abort the pass, do not measure.");
  process.exit(2);
}
const opens = await seededSessionOpens();
console.log(`liveness: seeded session ${opens ? "opens" : "does not open"}`);
if (!opens) {
  console.log("FAIL(precondition): a seeded session does not open in a real browser - abort the pass, do not measure.");
  process.exit(2);
}
console.log("liveness: OK - the pass may proceed, and its numbers are about the product.");
