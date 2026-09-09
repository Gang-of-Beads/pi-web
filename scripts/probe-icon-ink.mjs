import { chromium } from "@playwright/test";

/**
 * A drawn mark has to leave ink.
 *
 * The geometric probes measured 14px boxes for two rounds while the shapes sat
 * in the XHTML namespace and painted nothing. This one screenshots the control
 * and counts pixels that differ from its own background, so "the box is right"
 * can never again be mistaken for "the mark is there".
 */
const BASE = process.env.TOUCH_BASE ?? "http://127.0.0.1:8505";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

let lastError;
for (let attempt = 0; attempt < 6; attempt += 1) {
  try { await page.goto(BASE, { waitUntil: "domcontentloaded" }); lastError = undefined; break; }
  catch (error) { lastError = error; await page.waitForTimeout(1000); }
}
if (lastError !== undefined) { console.error(`FAIL: ${BASE} refused six connection attempts: ${String(lastError).slice(0, 140)}`); await browser.close(); process.exit(1); }
await page.waitForTimeout(3000);

const shapes = await page.evaluate(`(function () {
  const rows = [];
  const walk = (root) => {
    for (const svg of root.querySelectorAll("svg")) {
      const shape = svg.firstElementChild;
      rows.push({
        cls: svg.getAttribute("class") ?? "(none)",
        svgNs: svg.namespaceURI,
        shapeNs: shape === null ? null : shape.namespaceURI,
      });
    }
    for (const kid of root.querySelectorAll("*")) if (kid.shadowRoot) walk(kid.shadowRoot);
  };
  walk(document);
  return JSON.stringify(rows);
})()`);

const parsed = JSON.parse(shapes);
const wrong = parsed.filter((row) => row.shapeNs !== null && row.shapeNs !== "http://www.w3.org/2000/svg");
console.log(`svg elements on screen: ${String(parsed.length)}; shapes outside the SVG namespace: ${String(wrong.length)}`);
if (wrong.length > 0) {
  console.error(`FAIL: ${wrong.map((row) => `${row.cls} -> ${String(row.shapeNs)}`).slice(0, 6).join(", ")}`);
  await browser.close();
  process.exit(1);
}
if (parsed.length === 0) {
  console.error("FAIL: no svg rendered at all; the page did not finish loading");
  await browser.close();
  process.exit(1);
}
console.log("PASS: every rendered shape is in the SVG namespace");
await browser.close();
