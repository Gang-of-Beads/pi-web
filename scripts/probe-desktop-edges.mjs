#!/usr/bin/env node
/**
 * Desktop edges on the 8505 stack (owner, 2026-09-29), with the phone recorded as a control.
 *
 *   1. The context bar's two keys line up with the conversation: the grid key's left edge on
 *      the messages' left edge, the menu key's right edge on their right edge.
 *   2. The composer's action row has the same space above it (from the input) as below it (to
 *      the composer's bottom edge).
 *
 * Desktop is 1440x900 under a mouse. The phone, 393x850 under touch, is measured the same way
 * and printed so a run before and after a change shows it did not move; PI_WEB_PROBE_PHONE
 * holds the expected phone numbers as JSON and fails the run when they differ.
 */

import { chromium } from "playwright";

const BASE = process.env.PI_WEB_PROBE_BASE ?? "http://127.0.0.1:8505";
const PROJECT = process.env.PI_WEB_PROBE_PROJECT ?? "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = process.env.PI_WEB_PROBE_WORKSPACE ?? "ef2cdf93e1ac";
const SESSION = process.env.PI_WEB_PROBE_SESSION ?? "01a05000-5eed-7c00-8000-0000000000c1";
const PAGE_URL = `${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${SESSION}&view=chat`;

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`[${ok ? "ok" : "FAIL"}] ${name}: ${detail}`);
};

async function measure(browser, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  await page.goto(PAGE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  const edges = await page.evaluate(() => {
    const app = document.querySelector("pi-web-app")?.shadowRoot;
    const bar = app?.querySelector("app-context-bar")?.shadowRoot;
    const chat = app?.querySelector("chat-view")?.shadowRoot;
    const editor = app?.querySelector("prompt-editor")?.shadowRoot;
    const rect = (element) => {
      if (element === null || element === undefined) return null;
      const box = element.getBoundingClientRect();
      return { left: Math.round(box.left * 10) / 10, right: Math.round(box.right * 10) / 10, top: Math.round(box.top * 10) / 10, bottom: Math.round(box.bottom * 10) / 10 };
    };
    const messages = [...(chat?.querySelectorAll(".msg") ?? [])].filter((node) => node.getBoundingClientRect().height > 0);
    const buttons = [...(editor?.querySelectorAll(".actions > *") ?? [])].map((node) => node.getBoundingClientRect()).filter((box) => box.height > 0);
    const footer = rect(editor?.querySelector("footer"));
    return {
      grid: rect(bar?.querySelector(".go-to")),
      menu: rect(bar?.querySelector(".panel-toggle:not(.go-to)")),
      message: rect(messages.at(-1)),
      input: rect(editor?.querySelector(".editor-box")),
      rowTop: buttons.length === 0 ? null : Math.round(Math.min(...buttons.map((box) => box.top)) * 10) / 10,
      rowBottom: buttons.length === 0 ? null : Math.round(Math.max(...buttons.map((box) => box.bottom)) * 10) / 10,
      footerBottom: footer?.bottom ?? null,
    };
  });
  await page.screenshot({ path: `/tmp/desktop-edges-${String(contextOptions.viewport.width)}.png` });
  await context.close();
  const missing = Object.entries(edges).filter(([, value]) => value === null).map(([key]) => key);
  if (missing.length > 0) throw new Error(`precondition: nothing to measure for ${missing.join(", ")} at ${String(contextOptions.viewport.width)}px`);
  return {
    gridToMessageLeft: Math.round((edges.grid.left - edges.message.left) * 10) / 10,
    menuToMessageRight: Math.round((edges.menu.right - edges.message.right) * 10) / 10,
    aboveRow: Math.round((edges.rowTop - edges.input.bottom) * 10) / 10,
    belowRow: Math.round((edges.footerBottom - edges.rowBottom) * 10) / 10,
    gridLeft: edges.grid.left,
  };
}

const browser = await chromium.launch();
try {
  const desktop = await measure(browser, { viewport: { width: 1440, height: 900 } });
  record("desktop: the grid key starts where the messages start", Math.abs(desktop.gridToMessageLeft) <= 1, `grid - message left = ${String(desktop.gridToMessageLeft)}px`);
  record("desktop: the menu key ends where the messages end", Math.abs(desktop.menuToMessageRight) <= 1, `menu - message right = ${String(desktop.menuToMessageRight)}px`);
  record("desktop: the action row has equal space above and below", Math.abs(desktop.aboveRow - desktop.belowRow) <= 1, `above ${String(desktop.aboveRow)}px, below ${String(desktop.belowRow)}px`);
  const phone = await measure(browser, { viewport: { width: 393, height: 850 }, isMobile: true, hasTouch: true });
  console.log(`PHONE=${JSON.stringify(phone)}`);
  if (process.env.PI_WEB_PROBE_PHONE !== undefined) {
    const expected = JSON.parse(process.env.PI_WEB_PROBE_PHONE);
    record("phone: nothing moved", JSON.stringify(phone) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, measured ${JSON.stringify(phone)}`);
  }
} finally {
  await browser.close();
}
const failed = results.filter((result) => !result.ok);
console.log(`RECORDS=${String(results.length)} FAILED=${String(failed.length)}`);
process.exit(failed.length === 0 && results.length >= 3 ? 0 : 1);
