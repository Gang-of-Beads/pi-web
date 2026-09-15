#!/usr/bin/env node
/**
 * Live check: a screenshot-heavy session renders its tool-result images from
 * addresses, not inline base64, and its history cache entry is written.
 *
 * Preconditions (loud failures, never empty passes): the 8505 stack answers,
 * the seed manifest names the screenshot session, and the transcript page
 * carries the seeded number of image references.
 */
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const BASE = process.env.PI_WEB_PROBE_BASE ?? "http://127.0.0.1:8505";
const MANIFEST = `${process.env.HOME}/.pi-web-8505/pi-web-8505-seed-workspace/seed-manifest.json`;
const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
const seed = manifest.sessions?.screenshots;
if (seed === undefined) fail("seed manifest has no screenshots session; run scripts/seed-8505-subagent-attribution.mjs");
const cwd = manifest.workspace;

const projects = await (await fetch(`${BASE}/api/machines/local/projects`)).json();
if (!projects.some((project) => project.path === cwd)) {
  const added = await fetch(`${BASE}/api/machines/local/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: cwd }) });
  if (!added.ok) fail(`could not register the seed workspace as a project (${String(added.status)})`);
}

const pageUrl = `${BASE}/api/machines/local/sessions/${seed.id}/messages?cwd=${encodeURIComponent(cwd)}`;
const pageResponse = await fetch(pageUrl);
if (!pageResponse.ok) fail(`transcript page answered ${String(pageResponse.status)}`);
const pageText = await pageResponse.text();
const refs = (pageText.match(/"ref":\{/g) ?? []).length;
const inlinePngs = (pageText.match(/"data":"iVBOR/g) ?? []).length;
if (refs !== seed.toolResults) fail(`expected ${String(seed.toolResults)} image references on the wire, saw ${String(refs)}`);
if (inlinePngs !== 0) fail(`${String(inlinePngs)} images still travel inline as base64`);
console.log(`wire: ${String(pageText.length)} bytes, ${String(refs)} image refs, 0 inline`);

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true, colorScheme: "dark" });
const page = await context.newPage();
const imageResponses = [];
page.on("response", (response) => {
  if (response.url().includes("/tool-results/") && response.url().includes("/images/")) imageResponses.push({ url: response.url(), status: response.status(), type: response.headers()["content-type"], cacheControl: response.headers()["cache-control"] });
});
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("pi-web-app");
await page.waitForTimeout(3000);
const selected = await page.evaluate(`(async function(){
  const app = document.querySelector("pi-web-app");
  const state = Reflect.get(app, "state");
  const project = state.projects.find((candidate) => candidate.path === ${JSON.stringify(cwd)});
  if (project === undefined) return { error: "seed workspace is not a project on this stack" };
  await Reflect.get(app, "workspaces").selectProject(project);
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const sessions = Reflect.get(app, "state").sessions ?? [];
  const target = sessions.find((candidate) => candidate.id === ${JSON.stringify(seed.id)});
  if (target === undefined) return { error: "seeded screenshot session is not listed in the workspace" };
  await app.selectNavigationItem("sessions", "chat", () => Reflect.get(app, "sessions").selectSession(target));
  await new Promise((resolve) => setTimeout(resolve, 3500));
  return { ok: true };
})()`);
if (selected.error !== undefined) fail(selected.error);

const rendered = await page.evaluate(`(function(){
  const app = document.querySelector("pi-web-app");
  const view = app.shadowRoot.querySelector("chat-view");
  if (!view) return { error: "no chat-view mounted" };
  const images = [...view.shadowRoot.querySelectorAll("img.chat-image")];
  return { count: images.length, srcs: images.map((img) => img.getAttribute("src") ?? "") };
})()`);
if (rendered.error !== undefined) fail(rendered.error);
if (rendered.count === 0) fail("no chat images rendered; is the seeded session selected?");
if (rendered.count > seed.toolResults) fail(`rendered ${String(rendered.count)} images for ${String(seed.toolResults)} seeded results`);
const dataSrcs = rendered.srcs.filter((src) => src.startsWith("data:"));
if (dataSrcs.length !== 0) fail(`${String(dataSrcs.length)} rendered images still use data: URIs`);
const routeSrcs = rendered.srcs.filter((src) => src.includes("/tool-results/") && src.includes("/images/"));
if (routeSrcs.length !== rendered.count) fail(`rendered ${String(rendered.count)} images but only ${String(routeSrcs.length)} address the image route`);
console.log(`rendered: ${String(rendered.count)} images, all addressed through the image route`);

const loaded = await page.evaluate(`(async function(){
  const app = document.querySelector("pi-web-app");
  const view = app.shadowRoot.querySelector("chat-view");
  const images = [...view.shadowRoot.querySelectorAll("img.chat-image")];
  for (const img of images) { img.scrollIntoView(); await new Promise((resolve) => setTimeout(resolve, 150)); }
  await new Promise((resolve) => setTimeout(resolve, 2500));
  return images.map((img) => ({ complete: img.complete, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight }));
})()`);
const decoded = loaded.filter((img) => img.complete);
if (decoded.length === 0) fail("no rendered image finished loading from the image route");
const okImages = imageResponses.filter((r) => r.status === 200 && String(r.type).startsWith("image/"));
if (!imageResponses.every((r) => r.status !== 200 || String(r.cacheControl).includes("immutable"))) fail("an image-route response lacks the immutable cache-control the by-reference design relies on");
console.log(`fetched: ${String(decoded.length)}/${String(loaded.length)} images complete; ${String(okImages.length)} image-route responses observed (${okImages[0]?.type ?? "n/a"})`);

const cache = await page.evaluate(`(function(){
  const keys = Object.keys(sessionStorage).filter((key) => key.includes(${JSON.stringify(seed.id)}));
  return { keys, bytes: keys.reduce((sum, key) => sum + (sessionStorage.getItem(key) ?? "").length, 0) };
})()`);
if (cache.keys.length === 0) fail("history cache entry for the screenshot session was not written");
console.log(`cache: ${String(cache.keys.length)} entries, ${String(cache.bytes)} chars`);

await browser.close();
console.log("PASS: tool-result images travel as references and the session caches");
