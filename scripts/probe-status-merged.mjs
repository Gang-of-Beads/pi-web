/**
 * Everything this session is running reads as one status line.
 *
 * The owner rejected a strip of chips above the dock ("Background · 404 finished" that
 * opened a raw dump over the transcript): background work is part of the session's
 * status, so it rides the dock's own line - in every dock state, not only idle - and
 * no chip strip exists at all.
 */
import { chromium } from "playwright";
import { PROBE_BASE, openProbedSession } from "./probeSession.mjs";

const fails = [];
const fail = (message) => { fails.push(message); console.log("FAIL", message); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
await openProbedSession(page, PROBE_BASE);
await page.waitForTimeout(2500);

const read = () => page.evaluate(() => {
  const find = (root) => {
    for (const node of root.querySelectorAll("*")) {
      if (node.tagName === "CHAT-VIEW") return node;
      if (node.shadowRoot) {
        const inner = find(node.shadowRoot);
        if (inner) return inner;
      }
    }
    return null;
  };
  const view = find(document);
  if (view === null || view.shadowRoot === null) return null;
  const dock = view.shadowRoot.querySelector(".activity-dock");
  const rect = dock?.getBoundingClientRect();
  return {
    strip: view.shadowRoot.querySelectorAll(".runs, .runs-chip, .runs-body").length,
    dockText: dock?.textContent?.replace(/\s+/gu, " ").trim() ?? null,
    dockHeight: rect === undefined ? null : Math.round(rect.height),
  };
});

const before = await read();
console.log("before:", JSON.stringify(before));
if (before === null) fail("chat-view not found - precondition missing");
else {
  if (before.strip !== 0) fail(`a chip strip still renders (${String(before.strip)} nodes)`);
  if (before.dockText === null) fail("no activity dock on screen - precondition missing");
}

const merged = await page.evaluate(async () => {
  const find = (root) => {
    for (const node of root.querySelectorAll("*")) {
      if (node.tagName === "CHAT-VIEW") return node;
      if (node.shadowRoot) {
        const inner = find(node.shadowRoot);
        if (inner) return inner;
      }
    }
    return null;
  };
  const view = find(document);
  if (view === null) return null;
  view.status = { ...(view.status ?? {}), backgroundRunCount: 2 };
  await view.updateComplete;
  const dock = view.shadowRoot.querySelector(".activity-dock");
  const rect = dock?.getBoundingClientRect();
  const text = dock?.querySelector(".activity-text");
  return {
    dockText: dock?.textContent?.replace(/\s+/gu, " ").trim() ?? null,
    dockHeight: rect === undefined ? null : Math.round(rect.height),
    strip: view.shadowRoot.querySelectorAll(".runs, .runs-chip, .runs-body").length,
    clipped: text === null || text === undefined ? null : text.scrollWidth > text.clientWidth + 1,
  };
});
console.log("with 2 background runs:", JSON.stringify(merged));
if (merged === null) fail("chat-view vanished");
else {
  if (!merged.dockText?.includes("2 background runs")) fail(`the dock does not carry the background count: ${String(merged.dockText)}`);
  if (merged.strip !== 0) fail("a chip strip appeared for background work");
  if (merged.clipped !== false) fail(`the dock clips its own line at phone width (clipped=${String(merged.clipped)})`);
  if (merged.dockHeight !== null && before?.dockHeight !== null && merged.dockHeight > (before?.dockHeight ?? 0) + 2) fail(`the dock grew from ${String(before?.dockHeight)} to ${String(merged.dockHeight)}px - not one line`);
}

await page.screenshot({ path: "/tmp/status-merged.png" });
await browser.close();
console.log(fails.length === 0 ? "PASS status-merged" : `FAIL status-merged (${String(fails.length)})`);
process.exit(fails.length === 0 ? 0 : 1);
