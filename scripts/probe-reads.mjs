#!/usr/bin/env node
/**
 * Live check of the state-sync redesign's reads phase on the 8505 stack.
 *
 *   A. A deep link that names a tool in `view` and no `tool` opens that tool, which reads. The
 *      panel kept the tool it had before, and the named panel never rendered or read (reads F5).
 *      Phone, 393x850 under touch: the deep-link shape the phone probes use.
 *   B. The Subagents panel keeps one read in flight: with `runs.list` never answering, the poll
 *      stacked a new read every 3 s (reads F3). Desktop, 1440x900 under a mouse.
 *   C. A goals read that fails says so in the drawer instead of hiding the section (reads F4).
 *      Desktop.
 */

import { chromium } from "playwright";

const BASE = process.env.PI_WEB_PROBE_BASE ?? "http://127.0.0.1:8505";
const PROJECT = process.env.PI_WEB_PROBE_PROJECT ?? "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = process.env.PI_WEB_PROBE_WORKSPACE ?? "ef2cdf93e1ac";
const SESSION = process.env.PI_WEB_PROBE_SESSION ?? "01a05000-5eed-7c00-8000-0000000000c1";
const SUBAGENTS = "subagents:workspace.subagents";
const base = `${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${SESSION}`;

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`[${ok ? "ok" : "FAIL"}] ${name}: ${detail}`);
};

/** Every text node under the page, shadow roots included, joined. */
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

async function selected(page) {
  const id = await page.evaluate(() => document.querySelector("pi-web-app")?.state?.selectedSession?.id ?? null);
  if (id !== SESSION) throw new Error(`precondition: the app selected ${String(id)}, not ${SESSION}`);
}

const browser = await chromium.launch();
try {
  {
    const context = await browser.newContext({ viewport: { width: 393, height: 850 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const reads = [];
    page.on("request", (request) => { if (request.url().includes("/plugins/subagents/runs.list")) reads.push(request.url()); });
    await page.goto(`${base}&view=${encodeURIComponent(SUBAGENTS)}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(9000);
    await selected(page);
    const seen = await page.evaluate(() => ({ view: document.querySelector("pi-web-app")?.state?.mainView ?? null, tool: document.querySelector("pi-web-app")?.state?.workspaceTool ?? null }));
    if (seen.view !== SUBAGENTS) throw new Error(`precondition: the deep link did not put the view on Subagents (${JSON.stringify(seen)})`);
    record("A. a view-only deep link opens the tool it names, which reads", seen.tool === SUBAGENTS && reads.length > 0, `${JSON.stringify(seen)}, ${String(reads.length)} runs.list read(s)`);
    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const reads = [];
    await page.route("**/plugins/subagents/runs.list", (route) => { reads.push(Date.now()); void route; });
    await page.goto(`${base}&view=${encodeURIComponent(SUBAGENTS)}&tool=${encodeURIComponent(SUBAGENTS)}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    await selected(page);
    if (reads.length === 0) throw new Error("precondition: the Subagents panel never read");
    const first = reads.length;
    await page.waitForTimeout(10_000);
    record("B. a stalled runs read is not multiplied by the poll", reads.length === first, `${String(first)} read(s) when the panel opened, ${String(reads.length)} after 10 s more with none answered`);
    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    let failed = 0;
    await page.route("**/plugins/goals/goals.list", (route) => { failed += 1; void route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "probe: goals read refused" }) }); });
    await page.goto(`${base}&view=chat`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(9000);
    await selected(page);
    if (failed === 0) throw new Error("precondition: the goals section never read");
    const text = await deepText(page);
    record("C. a failed goals read says it could not be read", text.includes("Goal records could not be read"), `${String(failed)} refused read(s); ${text.includes("Reading goal records") ? "still says reading" : "no reading line"}`);
    await page.screenshot({ path: "/tmp/probe-reads-goals.png" });
    await context.close();
  }
} finally {
  await browser.close();
}
const failedResults = results.filter((result) => !result.ok);
console.log(`RECORDS=${String(results.length)} FAILED=${String(failedResults.length)}`);
process.exit(failedResults.length === 0 && results.length === 3 ? 0 : 1);
