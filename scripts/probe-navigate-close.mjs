#!/usr/bin/env node
/**
 * The phone's navigation page has one way back: the grid key (owner, 2026-09-30).
 *
 * On a 393x850 touch phone with a session open, "Open navigation" opens the page. It must carry
 * no separate close key, and its grid key must read "Close navigation" and take the reader back to
 * the chat in one tap. From a narrowed page (the Projects tab) it widens first and then goes back,
 * and the session behind the page stays selected: widening used to clear it. The Android back
 * gesture is the other way out, and is not driven here.
 */

import { chromium } from "playwright";

const BASE = process.env.PI_WEB_PROBE_BASE ?? "http://127.0.0.1:8505";
const PROJECT = process.env.PI_WEB_PROBE_PROJECT ?? "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = process.env.PI_WEB_PROBE_WORKSPACE ?? "ef2cdf93e1ac";
const SESSION = process.env.PI_WEB_PROBE_SESSION ?? "01a05000-5eed-7c00-8000-0000000000c1";

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`[${ok ? "ok" : "FAIL"}] ${name}: ${detail}`);
};

const pageKeys = (page) => page.evaluate(() => {
  const app = document.querySelector("pi-web-app");
  const navigate = app?.shadowRoot?.querySelector(".navigate-overlay app-navigate-page");
  const root = navigate?.shadowRoot;
  return {
    open: navigate !== null && navigate !== undefined,
    closeKeys: root?.querySelectorAll(".close").length ?? 0,
    grid: root?.querySelector(".quick-access")?.getAttribute("aria-label") ?? null,
    actions: [...(root?.querySelectorAll(".path-bar-actions button, .path-bar-actions app-refresh-control") ?? [])].map((node) => node.getAttribute("aria-label") ?? node.tagName.toLowerCase()),
  };
});

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${SESSION}&view=chat`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);
  const selected = await page.evaluate(() => document.querySelector("pi-web-app")?.state?.selectedSession?.id ?? null);
  if (selected !== SESSION) throw new Error(`precondition: the app selected ${String(selected)}, not ${SESSION}`);
  const opener = page.getByRole("button", { name: "Open navigation" });
  if ((await opener.count()) !== 1) throw new Error(`precondition: ${String(await opener.count())} "Open navigation" keys on the phone bar`);
  await opener.tap();
  await page.waitForTimeout(1200);
  const opened = await pageKeys(page);
  if (!opened.open) throw new Error("precondition: the navigation page did not open");
  await page.screenshot({ path: "/tmp/probe-navigate-close.png" });
  record("the phone's navigation page has no separate close key", opened.closeKeys === 0, JSON.stringify(opened));
  record("its grid key offers the way back", opened.grid === "Close navigation", `grid key reads ${JSON.stringify(opened.grid)}`);
  const grid = page.locator("pi-web-app .navigate-overlay app-navigate-page .quick-access");
  await grid.tap();
  await page.waitForTimeout(1200);
  const after = await pageKeys(page);
  const view = await page.evaluate(() => document.querySelector("pi-web-app")?.state?.mainView ?? null);
  record("one tap on the grid key returns to the chat", !after.open && view === "chat", JSON.stringify({ open: after.open, view }));

  await opener.tap();
  await page.waitForTimeout(1200);
  const projects = page.locator("pi-web-app .navigate-overlay app-navigate-page .kind", { hasText: "Projects" });
  if ((await projects.count()) !== 1) throw new Error("precondition: no Projects tab on the reopened navigation page");
  await projects.tap();
  await page.waitForTimeout(600);
  await grid.tap();
  await page.waitForTimeout(800);
  await grid.tap();
  await page.waitForTimeout(1200);
  const back = await page.evaluate(() => ({ session: document.querySelector("pi-web-app")?.state?.selectedSession?.id ?? null, view: document.querySelector("pi-web-app")?.state?.mainView ?? null }));
  const reopened = await pageKeys(page);
  record("from the Projects tab the grid key goes back to the same session", !reopened.open && back.session === SESSION && back.view === "chat", JSON.stringify({ open: reopened.open, ...back }));
  await context.close();
} finally {
  await browser.close();
}
const failed = results.filter((result) => !result.ok);
console.log(`RECORDS=${String(results.length)} FAILED=${String(failed.length)}`);
process.exit(failed.length === 0 && results.length === 4 ? 0 : 1);
