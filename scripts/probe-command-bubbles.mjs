#!/usr/bin/env node
/**
 * Live check at 393x850: a slash command typed in the composer shows as a
 * command bubble with a delivery mark, its result under it, and stays put.
 */
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const BASE = process.env.PI_WEB_PROBE_BASE ?? "http://127.0.0.1:8505";
const MANIFEST = `${process.env.HOME}/.pi-web-8505/pi-web-8505-seed-workspace/seed-manifest.json`;
const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
function fail(message) { console.error(`FAIL: ${message}`); process.exit(1); }

const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
const cwd = manifest.workspace;
const seed = manifest.sessions?.long;
if (seed === undefined) fail("no seeded session");

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true })).newPage();
try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("pi-web-app");
  await page.waitForTimeout(3000);
  const selected = await page.evaluate(`(async function(){
    const app = document.querySelector("pi-web-app");
    const project = Reflect.get(app, "state").projects.find((p) => p.path === ${JSON.stringify(cwd)});
    if (!project) return { error: "seed project missing" };
    await Reflect.get(app, "workspaces").selectProject(project);
    await new Promise((r) => setTimeout(r, 2500));
    const target = (Reflect.get(app, "state").sessions ?? []).find((s) => s.id === ${JSON.stringify(seed.id)});
    if (!target) return { error: "seed session not listed" };
    await Reflect.get(app, "openSessionFromQuickSwitcher").call(app, target);
    await new Promise((r) => setTimeout(r, 3000));
    await Reflect.get(app, "sessions").runCommand("/session");
    await Reflect.get(app, "sessions").runCommand("/new");
    await new Promise((r) => setTimeout(r, 2500));
    const chat = app.shadowRoot.querySelector("chat-view");
    const rows = [...chat.shadowRoot.querySelectorAll("article.msg.command")].map((row) => ({
      cls: row.className,
      text: row.querySelector(".command-text")?.textContent,
      result: row.querySelector(".command-result")?.textContent ?? null,
      mark: row.querySelector(".delivery-text")?.textContent,
      dismiss: row.querySelector("button") !== null,
      width: Math.round(row.getBoundingClientRect().width),
    }));
    return { rows };
  })()`);
  if (selected.error) fail(selected.error);
  console.log(JSON.stringify(selected.rows, null, 1));
  if (selected.rows.length !== 2) fail(`expected 2 command bubbles, saw ${selected.rows.length}`);
  const [session, unsupported] = selected.rows;
  if (session.mark !== "Read") fail(`/session mark ${session.mark}`);
  if (unsupported.mark !== "Not sent" || !unsupported.result) fail(`/new mark ${unsupported.mark} result ${unsupported.result}`);
  if (selected.rows.some((r) => r.dismiss)) fail("dismiss button still rendered");
  if (selected.rows.some((r) => r.width > 393)) fail("bubble overflows the phone width");
  await page.evaluate(`document.querySelector("pi-web-app").shadowRoot.querySelector("chat-view").shadowRoot.querySelector("article.msg.command")?.scrollIntoView()`);
  await page.screenshot({ path: "/tmp/journeys/command-bubbles.png" });
  console.log("PASS: command bubbles read with the delivery vocabulary, no dismiss, no overflow");
} finally {
  await browser.close();
}
