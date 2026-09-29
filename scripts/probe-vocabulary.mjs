#!/usr/bin/env node
/**
 * Live check of the state-sync redesign's vocabulary phase on the 8505 stack.
 *
 *   A. Every row of the Go to menu draws an icon, on the desktop (1440x900, mouse) and on a
 *      phone (393x850, touch). Subagents and Background shipped without one.
 *   B. A workspace whose goals read is empty says "No goals in this workspace." The section
 *      used to leave the drawer.
 *   C. A message sent while the browser is offline reads "Not sent". It read "No answer yet -
 *      this may already be running".
 *   D. A message whose send got no answer reads "Receiving…". While the ledger cannot be asked
 *      the top says "Reconnecting to update message status…"; once an ask gets through past the
 *      last scheduled one, the row reads "Not received" and the words are withdrawn. The asks
 *      used to stop after three, silently.
 *
 * Messages in C and D never reach the daemon: the browser is offline, or the prompt request is
 * aborted before it leaves. Each run marks its messages with its own timestamp.
 */

import { chromium } from "playwright";

const BASE = process.env.PI_WEB_PROBE_BASE ?? "http://127.0.0.1:8505";
const PROJECT = process.env.PI_WEB_PROBE_PROJECT ?? "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = process.env.PI_WEB_PROBE_WORKSPACE ?? "ef2cdf93e1ac";
const SESSION = process.env.PI_WEB_PROBE_SESSION ?? "01a05000-5eed-7c00-8000-0000000000c1";
const RUN = String(Date.now());
const chatUrl = `${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${SESSION}&view=chat`;
const RECONNECTING = "Reconnecting to update message status";

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`[${ok ? "ok" : "FAIL"}] ${name}: ${detail}`);
};

const deepText = (page) => page.evaluate(() => {
  const parts = [];
  const walk = (root) => {
    for (const node of root.querySelectorAll("*")) {
      if (node.shadowRoot !== null) walk(node.shadowRoot);
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) parts.push(node.textContent ?? "");
  };
  walk(document);
  return parts.join(" ").replace(/\s+/gu, " ");
});

async function openSession(page) {
  await page.goto(chatUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);
  const id = await page.evaluate(() => document.querySelector("pi-web-app")?.state?.selectedSession?.id ?? null);
  if (id !== SESSION) throw new Error(`precondition: the app selected ${String(id)}, not ${SESSION}; refusing to post into another session`);
}

/** Send one message through the composer, as the Send key does. */
async function send(page, text) {
  const sent = await page.evaluate(async (message) => {
    const editor = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("prompt-editor");
    if (editor === null || editor === undefined) return "no composer";
    Reflect.set(editor, "draft", message);
    Reflect.apply(Reflect.get(editor, "requestUpdate"), editor, []);
    await new Promise((resolve) => setTimeout(resolve, 300));
    Reflect.apply(Reflect.get(editor, "send"), editor, ["followUp"]);
    return "ok";
  }, text);
  if (sent !== "ok") throw new Error(`precondition: ${sent}`);
}

/**
 * The delivery words on the one row carrying this marker, or "rows:n" when there is not exactly
 * one. A row's text renders inside nested shadow roots, so it is read through them.
 */
const rowWords = (page, marker) => page.evaluate((wanted) => {
  const deep = (node) => {
    let text = node.textContent ?? "";
    for (const child of node.querySelectorAll("*")) if (child.shadowRoot !== null) text += ` ${deep(child.shadowRoot)}`;
    return text;
  };
  const app = document.querySelector("pi-web-app");
  const view = app?.shadowRoot?.querySelector("chat-view");
  const marks = [...(view?.shadowRoot?.querySelectorAll(".delivery-mark") ?? [])];
  const rows = marks.map((mark) => mark.closest("article, section")).filter((row) => row !== null && deep(row).includes(wanted));
  if (rows.length === 1) return (rows[0]?.querySelector(".delivery-text")?.textContent ?? "").trim();
  const line = (app?.state?.messages ?? []).find((candidate) => JSON.stringify(candidate.parts ?? []).includes(wanted));
  return `rows:${String(rows.length)} state:${JSON.stringify(line?.meta?.delivery ?? null)} marks:${String(marks.length)}`;
}, marker);

async function goToIcons(browser, name, options) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await openSession(page);
  const key = page.getByRole("button", { name: "Go to a view" }).first();
  if ((await key.count()) === 0) throw new Error(`precondition: no Go to key on the ${name}`);
  await key.click();
  await page.waitForTimeout(800);
  const rows = await page.evaluate(() => {
    const found = [];
    const walk = (root) => {
      for (const node of root.querySelectorAll("*")) {
        if (node.matches(".destination")) found.push({ label: (node.textContent ?? "").replace(/\s+/gu, " ").trim().slice(0, 30), icon: node.querySelector(".destination-icon svg") !== null });
        if (node.shadowRoot !== null) walk(node.shadowRoot);
      }
    };
    walk(document);
    return found;
  });
  await page.screenshot({ path: `/tmp/probe-vocabulary-goto-${name}.png` });
  const labels = rows.map((row) => row.label).join(" | ");
  if (!labels.includes("Subagents") || !labels.includes("Background")) throw new Error(`precondition: the ${name} Go to menu lacks Subagents or Background: ${labels}`);
  const blank = rows.filter((row) => !row.icon).map((row) => row.label);
  record(`A. every Go to row on the ${name} has an icon`, blank.length === 0, `${String(rows.length)} rows; without an icon: ${JSON.stringify(blank)}`);
  await context.close();
}

const browser = await chromium.launch();
try {
  await goToIcons(browser, "desktop", { viewport: { width: 1440, height: 900 } });
  await goToIcons(browser, "phone", { viewport: { width: 393, height: 850 }, isMobile: true, hasTouch: true });

  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    let answered = 0;
    await page.route("**/plugins/goals/goals.list", (route) => { answered += 1; void route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ goals: [], brokenFiles: 0 }) }); });
    await openSession(page);
    if (answered === 0) throw new Error("precondition: the goals section never read");
    const text = await deepText(page);
    record("B. an empty goals read says there are no goals", text.includes("No goals in this workspace."), `${String(answered)} empty answer(s); ${text.includes("Goals") ? "a Goals section is on the page" : "no Goals section on the page"}`);
    await page.screenshot({ path: "/tmp/probe-vocabulary-goals.png" });
    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await openSession(page);
    const marker = `vocabulary-probe offline ${RUN}`;
    await context.setOffline(true);
    await send(page, marker);
    await page.waitForTimeout(4000);
    const offline = await page.evaluate(() => navigator.onLine);
    if (offline) throw new Error("precondition: the browser still reports itself online");
    const words = await rowWords(page, marker);
    record("C. a message sent while offline reads Not sent", words === "Not sent", `row reads ${JSON.stringify(words)}`);
    await page.screenshot({ path: "/tmp/probe-vocabulary-offline.png" });
    await context.setOffline(false);
    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    let ledgerDown = true;
    let asks = 0;
    await page.route("**/prompt*", (route) => route.abort("failed"));
    await page.route("**/operations*", (route) => {
      asks += 1;
      return ledgerDown ? route.abort("failed") : route.continue();
    });
    await openSession(page);
    const marker = `vocabulary-probe receiving ${RUN}`;
    await send(page, marker);
    await page.waitForTimeout(3000);
    const receiving = await rowWords(page, marker);
    if (receiving.startsWith("rows:")) throw new Error(`precondition: the aborted send left ${receiving}`);
    await page.waitForTimeout(5000);
    const whileDown = { words: await rowWords(page, marker), top: (await deepText(page)).includes(RECONNECTING), asks };
    record("D1. an unanswered send reads Receiving… and the top says it is reconnecting", receiving === "Receiving…" && whileDown.words === "Receiving…" && whileDown.top, JSON.stringify({ receiving, ...whileDown }));
    await page.waitForTimeout(40_000);
    const pastTheLast = asks;
    ledgerDown = false;
    await page.waitForTimeout(18_000);
    const through = { words: await rowWords(page, marker), top: (await deepText(page)).includes(RECONNECTING), asksWhileDown: pastTheLast, asks };
    record("D2. once an ask gets through past the last one, the row reads Not received and the words go", pastTheLast > 3 && through.words === "Not received" && !through.top, JSON.stringify(through));
    await page.screenshot({ path: "/tmp/probe-vocabulary-receiving.png" });
    await context.close();
  }
} finally {
  await browser.close();
}
const failedResults = results.filter((result) => !result.ok);
console.log(`RECORDS=${String(results.length)} FAILED=${String(failedResults.length)}`);
process.exit(failedResults.length === 0 && results.length === 6 ? 0 : 1);
