#!/usr/bin/env node
/**
 * Live check at 393x850 coarse: every edge-anchored surface starts and ends on
 * the same column. The composer box is the reference the owner named; the bar
 * controls above it and the composer's own second row must agree with it.
 */
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const BASE = process.env.PI_WEB_PROBE_BASE ?? "http://127.0.0.1:8505";
const MANIFEST = `${process.env.HOME}/.pi-web-8505/pi-web-8505-seed-workspace/seed-manifest.json`;

function fail(message) { console.error(`FAIL: ${message}`); process.exit(1); }

const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true })).newPage();

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("pi-web-app");
await page.waitForTimeout(3000);
await page.evaluate(`(async function(){
  const app = document.querySelector("pi-web-app");
  const project = Reflect.get(app, "state").projects.find((p) => p.path === ${JSON.stringify(manifest.workspace)});
  if (!project) throw new Error("seed project missing");
  await Reflect.get(app, "workspaces").selectProject(project);
  await new Promise((r) => setTimeout(r, 2000));
  const session = Reflect.get(app, "state").sessions[0];
  if (!session) throw new Error("seed session missing");
  await Reflect.get(app, "openSessionFromQuickSwitcher").call(app, session);
  await new Promise((r) => setTimeout(r, 2500));
})()`);

await page.evaluate(`(function(){ const app = document.querySelector("pi-web-app"); Reflect.get(app, "openNavigate").call(app); })()`);
await page.waitForTimeout(1200);

const measured = await page.evaluate(() => {
  const width = window.innerWidth;
  const app = document.querySelector("pi-web-app");
  const root = app?.shadowRoot;
  if (root === null || root === undefined) return { error: "no app root" };
  const box = (element, name) => {
    if (element === null || element === undefined) return undefined;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0) return undefined;
    return { name, left: Math.round(rect.x), right: Math.round(width - rect.right) };
  };
  const bar = root.querySelector("app-context-bar")?.shadowRoot ?? null;
  const editor = root.querySelector("prompt-editor")?.shadowRoot ?? null;
  const barControls = bar === null ? [] : [...bar.querySelectorAll(".panel-toggle, .session-title, button")];
  const actionRow = editor?.querySelector(".actions") ?? null;
  const actionControls = actionRow === null ? [] : [...actionRow.children];
  const first = (list) => list[0];
  const last = (list) => list[list.length - 1];
  return {
    width,
    entries: [
      box(first(barControls), "bar first control"),
      box(last(barControls), "bar last control"),
      box(editor?.querySelector(".editor-wrap") ?? editor?.querySelector("textarea") ?? null, "composer box"),
      box(first(actionControls), "composer row first control"),
      box(last(actionControls), "composer row last control"),
      box(root.querySelector("status-bar")?.shadowRoot?.querySelector(".status-bar") ?? null, "status bar"),
      box(root.querySelector("chat-view")?.shadowRoot?.querySelector(".msg") ?? null, "first message card"),
      box(root.querySelector("chat-view")?.shadowRoot?.querySelector(".activity-dock") ?? null, "activity dock"),
      ...(() => {
        const hosts = [...root.querySelectorAll("app-navigate-page")];
        const page = hosts[hosts.length - 1]?.shadowRoot ?? null;
        if (page === null || page === undefined) return [];
        const lastOf = (selector) => { const all = [...page.querySelectorAll(selector)]; return all[all.length - 1] ?? null; };
        return [
          box(page.querySelector(".quick-access"), "navigate first control"),
          box(page.querySelector(".kind"), "navigate first kind tab"),
          box(lastOf(".kind"), "navigate last kind tab"),
          box(page.querySelector(".row-wrap"), "navigate first tile"),
          box(lastOf(".row-wrap"), "navigate last tile"),
        ];
      })(),
    ].filter((entry) => entry !== undefined),
  };
});

await page.screenshot({ path: "/tmp/journeys/edge-inset.png" });
await browser.close();

if (measured.error !== undefined) fail(measured.error);
console.log(JSON.stringify(measured, null, 2));

const reference = measured.entries.find((entry) => entry.name === "composer box");
if (reference === undefined) fail("the composer box was not measured, so this probe proves nothing");
// The navigate list is a two-column board, so only the first tile answers for
// the left column and only a tile in the right column answers for the right.
const LEFT_ANCHORED = new Set(["bar first control", "composer row first control", "composer box", "status bar", "first message card", "activity dock", "navigate first control", "navigate first kind tab", "navigate first tile"]);
const RIGHT_ANCHORED = new Set(["bar last control", "composer row last control", "composer box", "status bar", "first message card", "navigate last kind tab"]);
const off = measured.entries.filter((entry) =>
  (LEFT_ANCHORED.has(entry.name) && entry.left !== reference.left)
  || (RIGHT_ANCHORED.has(entry.name) && entry.right !== reference.right));
if (off.length > 0) {
  fail(`these surfaces do not share the composer's column (${String(reference.left)}/${String(reference.right)}): ${off.map((entry) => `${entry.name} ${String(entry.left)}/${String(entry.right)}`).join(", ")}`);
}
console.log(`PASS: every edge surface starts at ${String(reference.left)} and ends at ${String(reference.right)}`);
