#!/usr/bin/env node
/**
 * README effect shots, taken from the live 8505 dev stack.
 *
 * The images in the README are the first thing anyone sees, so they must come
 * from the product as it actually renders - a real session, a real daemon, the
 * real navigation board - not a mockup that drifts. Session titles are seeded
 * through the running gateway so the frames read as a plausible day's work
 * instead of the probe names the seed ships with.
 *
 * The titles are presentational only: renaming a real session would run an
 * agent turn, so the shot script relabels the rows in the browser before the
 * frame. Everything else in the frame - the board, the transcript, the sheet -
 * is the running product.
 *
 * Fails loudly: a missing surface is an error, never an empty frame.
 */

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.PI_WEB_SHOT_BASE ?? "http://127.0.0.1:8505";
const OUT = process.env.PI_WEB_SHOT_DIR ?? "docs/assets";

const TITLES = [
  "Ship the release notes for 2.3",
  "Fix the flaky upload test",
  "Migrate the billing schema",
  "Review the auth refactor",
  "Trace the slow dashboard query",
  "Draft the on-call runbook",
];

function fail(message) {
  throw new Error(message);
}

async function relabel(page) {
  const named = await page.evaluate((titles) => {
    const app = document.querySelector("pi-web-app");
    if (app === null) return "no app";
    // The board lists the machine's own listing, which is where the names the
    // frame shows come from: relabelling only the workspace's sessions left
    // the board untouched.
    const state = Reflect.get(app, "state");
    const listing = Reflect.get(app, "quickSwitcherSessions") ?? [];
    const rows = listing.length > 0 ? listing : (state?.sessions ?? []);
    if (rows.length === 0) return "no sessions to label";
    const rename = (list) => list.map((session, index) => ({ ...session, name: titles[index % titles.length] }));
    const setState = Reflect.get(app, "setState");
    Reflect.apply(setState, app, [{ sessions: rename(state?.sessions ?? []) }]);
    Reflect.set(app, "quickSwitcherSessions", rename([...listing]));
    app.requestUpdate();
    return "ok";
  }, TITLES);
  if (named !== "ok") fail(`Could not label the rows for the shots: ${named}`);
}

/** The shots show the product's own dark look, whatever the last run left. */
async function useNativeDarkTheme(page) {
  await page.evaluate(() => {
    localStorage.setItem("pi-web-app-theme", JSON.stringify({ themeId: "core:pro", auto: false }));
  });
}

async function shot(page, path, { width, height }, prepare) {
  await page.setViewportSize({ width, height });
  await page.goto(`${BASE}/?project=${encodeURIComponent(process.env.PI_WEB_SHOT_PROJECT ?? "")}`, { waitUntil: "domcontentloaded" });
  await useNativeDarkTheme(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  await relabel(page);
  await prepare(page);
  await page.waitForTimeout(900);
  await page.screenshot({ path, scale: "css" });
  return path;
}

async function openFirstSession(page) {
  const opened = await page.evaluate(async () => {
    const app = document.querySelector("pi-web-app");
    if (app === null) return "no app";
    const boards = [...app.shadowRoot.querySelectorAll("app-navigate-page")].filter((board) => board.getBoundingClientRect().width > 0);
    const board = boards[boards.length - 1];
    if (board === undefined) return "no navigation board";
    const row = board.shadowRoot.querySelector(".row.session");
    if (row === null) return "no session row";
    row.click();
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return app.shadowRoot.querySelector("chat-view") === null ? "no transcript" : "ok";
  });
  if (opened !== "ok") fail(`Could not open a session for the shot: ${opened}`);
}

async function openGoTo(page) {
  await openFirstSession(page);
  const opened = await page.evaluate(async () => {
    const app = document.querySelector("pi-web-app");
    const bar = app?.shadowRoot.querySelector("app-context-bar");
    const key = [...(bar?.shadowRoot.querySelectorAll(".panel-toggle") ?? [])].find((button) => button.getAttribute("aria-label") === "Go to a view");
    if (key === undefined) return "no Go to key";
    key.click();
    await new Promise((resolve) => setTimeout(resolve, 800));
    return app.shadowRoot.querySelector("app-go-to-sheet") === null ? "sheet did not open" : "ok";
  });
  if (opened !== "ok") fail(`Could not open the Go to sheet: ${opened}`);
}

async function showBoard(page) {
  const shown = await page.evaluate(async () => {
    const app = document.querySelector("pi-web-app");
    if (app === null) return "no app";
    const boards = [...app.shadowRoot.querySelectorAll("app-navigate-page")].filter((board) => board.getBoundingClientRect().width > 0);
    const board = boards[boards.length - 1];
    if (board === undefined) return "no navigation board";
    if (board.shadowRoot.querySelector(".row.session") === null) return "board listed no sessions";
    return "ok";
  });
  if (shown !== "ok") fail(`Could not show the navigation board: ${shown}`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  const written = [];
  try {
    written.push(await shot(page, `${OUT}/pi-web-desktop.png`, { width: 1440, height: 900 }, openFirstSession));
    written.push(await shot(page, `${OUT}/pi-web-tablet.png`, { width: 834, height: 1112 }, showBoard));
    const phone = await browser.newPage({ deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    try {
      written.push(await shot(phone, `${OUT}/pi-web-mobile.png`, { width: 393, height: 850 }, showBoard));
      written.push(await shot(phone, `${OUT}/pi-web-mobile-goto.png`, { width: 393, height: 850 }, openGoTo));
    } finally {
      await phone.close();
    }
  } finally {
    await browser.close();
  }
  for (const path of written) console.log(`wrote ${path}`);
}

await main();
