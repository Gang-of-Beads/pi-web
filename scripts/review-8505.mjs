/**
 * A look at the running 8505 stack through a phone, for the things unit tests
 * cannot see: what a person actually gets on screen.
 *
 * This is not a test suite and asserts nothing. It drives the app, records what
 * it finds, and writes screenshots to /tmp/review-8505. Read the output; do not
 * treat a clean run as a pass. A probe that cannot reach a surface reports "not
 * reached" rather than staying silent, because a surface nobody looked at must
 * not read as a surface that was fine.
 *
 * Usage: node scripts/review-8505.mjs [baseUrl]
 */
import { chromium, devices } from "@playwright/test";
import { mkdirSync } from "node:fs";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:8505";
const shotDir = "/tmp/review-8505";
mkdirSync(shotDir, { recursive: true });

const findings = [];
function record(area, verdict, detail) {
  findings.push({ area, verdict, detail });
  console.log(`[${verdict}] ${area}: ${detail}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices["Pixel 7"] });
const page = await context.newPage();

const consoleErrors = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => { consoleErrors.push(`pageerror: ${error.message}`); });

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${shotDir}/01-boot.png`, fullPage: false });
  record("boot", "info", `title=${JSON.stringify(await page.title())} url=${page.url()}`);

  // Every interactive target has to clear the coarse-pointer floor. This is a
  // geometry rule the owner should never have to report twice.
  const small = await page.evaluate(() => {
    const out = [];
    const visit = (root) => {
      for (const el of root.querySelectorAll("button, [role=button], a[href], input, select")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.width < 44 || r.height < 44) out.push({ tag: el.tagName.toLowerCase(), label: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 28), w: Math.round(r.width), h: Math.round(r.height) });
      }
      for (const el of root.querySelectorAll("*")) if (el.shadowRoot) visit(el.shadowRoot);
    };
    visit(document);
    return out.slice(0, 20);
  });
  record("touch targets", small.length === 0 ? "ok" : "check", small.length === 0 ? "every visible control is at least 44x44" : `${small.length} under 44px: ${JSON.stringify(small.slice(0, 6))}`);

  // A surface that says it is loading must stop saying it. This is the stuck
  // "Loading this session..." the owner reported after a quick-access switch.
  const bodyText = await page.evaluate(() => document.body.innerText);
  const stuckWords = ["Loading this session", "Session not found"];
  const present = stuckWords.filter((w) => bodyText.includes(w));
  record("honest states", present.length === 0 ? "ok" : "check", present.length === 0 ? "no stuck loading or not-found text on the landing surface" : `present: ${present.join(", ")}`);

  // Panels for extensions that are not installed should not be offered.
  const tabs = await page.evaluate(() => {
    const out = [];
    const visit = (root) => {
      for (const el of root.querySelectorAll("button, [role=tab]")) {
        const t = (el.textContent ?? "").trim();
        if (t.length > 0 && t.length < 40) out.push(t);
      }
      for (const el of root.querySelectorAll("*")) if (el.shadowRoot) visit(el.shadowRoot);
    };
    visit(document);
    return [...new Set(out)].slice(0, 24);
  });
  record("navigation tabs", "info", JSON.stringify(tabs));

  record("console", consoleErrors.length === 0 ? "ok" : "check", consoleErrors.length === 0 ? "no console errors during boot" : `${consoleErrors.length}: ${JSON.stringify(consoleErrors.slice(0, 4))}`);
} catch (error) {
  record("run", "not reached", `${error instanceof Error ? error.message : String(error)}`);
} finally {
  await page.screenshot({ path: `${shotDir}/99-final.png` }).catch(() => {});
  await browser.close();
}

console.log(`\nscreenshots: ${shotDir}`);
console.log(`checks needing a look: ${findings.filter((f) => f.verdict !== "ok" && f.verdict !== "info").length}`);
