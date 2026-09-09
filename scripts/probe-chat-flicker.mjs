import { chromium } from "@playwright/test";

/**
 * Flicker, measured rather than described.
 *
 * The owner reports that the chat surface flickers. Flicker on a lit surface
 * has three plausible mechanisms and they are distinguishable: DOM subtrees
 * being replaced instead of updated (element identity churn), geometry moving
 * between frames (layout jump), and opacity or colour transitions firing on
 * content that is merely being appended.
 *
 * This probe counts all three while the page is live, so a fix can be argued
 * from numbers instead of from an impression.
 */
const BASE = process.env.TOUCH_BASE ?? "http://127.0.0.1:8505";
const SAMPLE_MS = Number(process.env.FLICKER_SAMPLE_MS ?? 6000);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });

let lastError;
for (let attempt = 0; attempt < 6; attempt += 1) {
  try { await page.goto(BASE, { waitUntil: "domcontentloaded" }); lastError = undefined; break; }
  catch (error) { lastError = error; await page.waitForTimeout(1000); }
}
if (lastError !== undefined) { console.error(`FAIL: ${BASE} refused six connection attempts`); await browser.close(); process.exit(1); }
await page.waitForTimeout(3000);

/* Drive into a real conversation: flicker is reported there, and the boot
   screen has no transcript, no turn clock and nothing streaming to observe.
   Each list lives in its own shadow root, so the walk targets the host it
   belongs to rather than the first .action-main on the page. */
const clickInside = async (host, selector) => page.evaluate(`(function () {
  let label = "none";
  const walk = (root) => {
    for (const element of root.querySelectorAll(${JSON.stringify(host)})) {
      const shadow = element.shadowRoot;
      if (shadow === null) continue;
      const target = shadow.querySelector(${JSON.stringify(selector)});
      if (target !== null) { target.click(); label = (target.textContent ?? "").trim().slice(0, 28); return; }
    }
    for (const kid of root.querySelectorAll("*")) if (kid.shadowRoot) walk(kid.shadowRoot);
  };
  walk(document);
  return label;
})()`);

for (const [host, wait] of [["project-list", 1800], ["workspace-list", 2000], ["session-list", 2600]]) {
  const label = await clickInside(host, ".action-main");
  if (label === "none") { console.error(`FAIL: no row to click in ${host}; the stack has no seeded session to observe`); await browser.close(); process.exit(1); }
  await page.waitForTimeout(wait);
}

const reachedChat = await page.evaluate(`(function () {
  let found = false;
  const walk = (root) => {
    if (root.querySelector("chat-view") !== null) found = true;
    for (const kid of root.querySelectorAll("*")) if (kid.shadowRoot) walk(kid.shadowRoot);
  };
  walk(document);
  return found;
})()`);
if (!reachedChat) { console.error("FAIL: could not reach a chat surface; an empty sample would prove nothing"); await browser.close(); process.exit(1); }

await page.evaluate(`(function () {
  const counters = { removed: 0, added: 0, attributeChurn: 0, styleChurn: 0, roots: 0 };
  const seen = new WeakSet();
  const observe = (root) => {
    if (seen.has(root)) return;
    seen.add(root);
    counters.roots += 1;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        counters.removed += record.removedNodes.length;
        counters.added += record.addedNodes.length;
        if (record.type === "attributes") {
          counters.attributeChurn += 1;
          if (record.attributeName === "style" || record.attributeName === "class") counters.styleChurn += 1;
        }
      }
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeOldValue: false });
    for (const node of root.querySelectorAll("*")) if (node.shadowRoot) observe(node.shadowRoot);
  };
  observe(document);
  window.__flicker = counters;
  window.__flickerRescan = () => observe(document);
})()`);

const rescanTimer = setInterval(() => { void page.evaluate("window.__flickerRescan && window.__flickerRescan()"); }, 500);
await page.waitForTimeout(SAMPLE_MS);
clearInterval(rescanTimer);

const counters = await page.evaluate("JSON.stringify(window.__flicker)");
console.log(`idle sample over ${String(SAMPLE_MS)}ms:`, counters);

const transitions = await page.evaluate(`(function () {
  const rows = [];
  const walk = (root) => {
    for (const node of root.querySelectorAll("*")) {
      const style = getComputedStyle(node);
      const property = style.transitionProperty;
      if (property === "none" || property === "") continue;
      const cls = (node.getAttribute("class") ?? node.tagName).slice(0, 32);
      if (/opacity|background|color|all/u.test(property)) rows.push(cls + " -> " + property + " " + style.transitionDuration);
      if (node.shadowRoot) walk(node.shadowRoot);
    }
  };
  walk(document);
  const unique = [...new Set(rows)];
  return JSON.stringify({ count: rows.length, unique: unique.slice(0, 12) });
})()`);
console.log("elements animating colour/opacity:", transitions);

/**
 * How often the chat surface re-renders when nothing was typed.
 *
 * A lit element that re-renders on a timer does not necessarily churn the DOM,
 * but it does re-evaluate every template on the surface, and any part that is
 * not keyed - or any style that is recomputed - can repaint. Counting updates
 * separates "the DOM is stable" from "the renderer is quiet".
 */
const renders = await page.evaluate(`(function () {
  const found = [];
  const walk = (root) => {
    for (const node of root.querySelectorAll("chat-view, prompt-editor, status-bar, conversation-meter, pi-web-goals-section")) found.push(node);
    for (const kid of root.querySelectorAll("*")) if (kid.shadowRoot) walk(kid.shadowRoot);
  };
  walk(document);
  const counts = {};
  for (const node of found) {
    const name = node.tagName.toLowerCase();
    counts[name] = 0;
    const original = node.performUpdate?.bind(node);
    if (original === undefined) continue;
    node.performUpdate = function patched() { counts[name] += 1; return original(); };
  }
  window.__renderCounts = counts;
  return JSON.stringify(Object.keys(counts));
})()`);
console.log("instrumented elements:", renders);

await page.waitForTimeout(SAMPLE_MS);
console.log(`renders while idle over ${String(SAMPLE_MS)}ms:`, await page.evaluate("JSON.stringify(window.__renderCounts)"));

/* Scrolling is the other place a phone shows tearing: sticky chrome that is
   re-laid-out per frame, or a scroll handler that writes style during scroll. */
await page.evaluate(`(function () {
  window.__scrollWrites = 0;
  const target = (() => {
    let found = null;
    const walk = (root) => {
      for (const node of root.querySelectorAll("*")) {
        if (found === null && node.scrollHeight > node.clientHeight + 40 && node.clientHeight > 200) found = node;
        if (node.shadowRoot) walk(node.shadowRoot);
      }
    };
    walk(document);
    return found;
  })();
  window.__scrollTarget = target;
  const observer = new MutationObserver((records) => { window.__scrollWrites += records.length; });
  if (target !== null) observer.observe(target.getRootNode(), { subtree: true, attributes: true, attributeFilter: ["style", "class"] });
  return target === null ? "none" : (target.getAttribute("class") ?? target.tagName);
})()`);

for (let step = 0; step < 12; step += 1) {
  await page.evaluate("window.__scrollTarget && window.__scrollTarget.scrollBy(0, 120)");
  await page.waitForTimeout(120);
}
console.log("style/class writes during a 12-step scroll:", await page.evaluate("String(window.__scrollWrites)"));
console.log("renders after scrolling:", await page.evaluate("JSON.stringify(window.__renderCounts)"));

/**
 * The state the owner reports flicker in: a reply arriving.
 *
 * One word of output is enough - the question is whether appending to a
 * streaming message churns DOM or repaints the surface, not how long the answer
 * is. If the composer cannot be driven, this says so rather than reporting a
 * quiet sample as evidence of calm.
 */
const typed = await page.evaluate(`(function () {
  let editor = null;
  const walk = (root) => {
    for (const node of root.querySelectorAll("textarea, [contenteditable='true'], .cm-content")) if (editor === null) editor = node;
    for (const kid of root.querySelectorAll("*")) if (kid.shadowRoot) walk(kid.shadowRoot);
  };
  walk(document);
  if (editor === null) return "none";
  editor.focus();
  return editor.tagName.toLowerCase();
})()`);
console.log("composer focused:", typed);

if (typed !== "none" && process.env.FLICKER_SEND === "1") {
  await page.keyboard.type("Reply with exactly one word: hi");
  await page.evaluate("(function(){ window.__flicker.removed = 0; window.__flicker.added = 0; window.__flicker.attributeChurn = 0; window.__flicker.styleChurn = 0; for (const key of Object.keys(window.__renderCounts)) window.__renderCounts[key] = 0; })()");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(Number(process.env.FLICKER_STREAM_MS ?? 15000));
  console.log("during a reply — dom churn:", await page.evaluate("JSON.stringify(window.__flicker)"));
  console.log("during a reply — renders:", await page.evaluate("JSON.stringify(window.__renderCounts)"));
} else {
  console.log("NOT MEASURED: streaming sample skipped (set FLICKER_SEND=1 to run a real turn)");
}

await browser.close();
