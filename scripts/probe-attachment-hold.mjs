#!/usr/bin/env node
/**
 * An image attached in the composer survives switching to another session and back
 * (owner, 2026-09-29: "I attached an image, switched out and back, and it was gone").
 *
 * Desktop, 1440x900 under a mouse on the 8505 stack: attach a PNG through the composer's file
 * input, click another session in the navigation list, check its composer is empty, click the
 * first session again, and count the attachment chips.
 */

import { chromium } from "playwright";

const BASE = process.env.PI_WEB_PROBE_BASE ?? "http://127.0.0.1:8505";
const PROJECT = process.env.PI_WEB_PROBE_PROJECT ?? "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = process.env.PI_WEB_PROBE_WORKSPACE ?? "ef2cdf93e1ac";
const SESSION = process.env.PI_WEB_PROBE_SESSION ?? "01a05000-5eed-7c00-8000-0000000000c1";
const PAGE_URL = `${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${SESSION}&view=chat`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`[${ok ? "ok" : "FAIL"}] ${name}: ${detail}`);
};

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(PAGE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  const selected = () => page.evaluate(() => document.querySelector("pi-web-app")?.state?.selectedSession?.id ?? null);
  if ((await selected()) !== SESSION) throw new Error(`precondition: the app selected ${String(await selected())}, not ${SESSION}`);
  const chips = () => page.locator("prompt-editor .attachment-chip").count();
  const titles = await page.evaluate((current) => {
    const sessions = document.querySelector("pi-web-app")?.state?.sessions ?? [];
    const title = (session) => {
      const label = typeof session.name === "string" && session.name.trim() !== "" ? session.name.trim() : String(session.firstMessage ?? "").trim();
      return label === "" ? null : label;
    };
    const mine = sessions.find((session) => session.id === current);
    const other = sessions.find((session) => session.id !== current && title(session) !== null && sessions.filter((candidate) => title(candidate) === title(session)).length === 1);
    return { mine: mine === undefined ? null : title(mine), other: other === undefined ? null : { id: other.id, title: title(other) } };
  }, SESSION);
  if (titles.mine === null || titles.other === null) throw new Error(`precondition: no uniquely titled sessions to switch between (${JSON.stringify(titles)})`);

  await page.locator("prompt-editor input.attachment-input").setInputFiles({ name: "hold-probe.png", mimeType: "image/png", buffer: PNG });
  await page.waitForTimeout(1500);
  const attached = await chips();
  if (attached !== 1) throw new Error(`precondition: the composer shows ${String(attached)} attachments after attaching one`);

  await page.locator("#navigation-panel").getByText(titles.other.title, { exact: true }).first().click();
  await page.waitForTimeout(3000);
  const away = { session: await selected(), chips: await chips() };
  if (away.session !== titles.other.id) throw new Error(`precondition: clicking "${titles.other.title}" selected ${String(away.session)}`);
  record("the other session's composer does not show the image", away.chips === 0, JSON.stringify(away));

  await page.locator("#navigation-panel").getByText(titles.mine, { exact: true }).first().click();
  await page.waitForTimeout(3000);
  const back = { session: await selected(), chips: await chips() };
  if (back.session !== SESSION) throw new Error(`precondition: clicking "${titles.mine}" selected ${String(back.session)}`);
  record("the image is back when the reader returns", back.chips === 1, JSON.stringify(back));
  await page.screenshot({ path: "/tmp/attachment-hold-back.png" });
  await context.close();
} finally {
  await browser.close();
}
const failed = results.filter((result) => !result.ok);
console.log(`RECORDS=${String(results.length)} FAILED=${String(failed.length)}`);
process.exit(failed.length === 0 && results.length === 2 ? 0 : 1);
