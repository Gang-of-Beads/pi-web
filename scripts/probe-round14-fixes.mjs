import { chromium } from "@playwright/test";

const BASE = "http://127.0.0.1:8505";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);

const readings = await page.evaluate(`(function () {
  const out = {};
  const walk = (root) => {
    const empty = root.querySelector(".empty");
    if (empty && out.emptyBorder === undefined) {
      const style = getComputedStyle(empty);
      out.emptyBorder = style.borderTopWidth + " " + style.borderTopStyle;
      out.emptyPadding = style.paddingTop;
    }
    const bar = root.querySelector("status-bar, .bar");
    if (bar && out.statusPadding === undefined) out.statusPadding = getComputedStyle(bar).paddingLeft;
    const dialog = root.querySelector('section[role="dialog"]');
    if (dialog && out.dialogShadow === undefined) out.dialogShadow = getComputedStyle(dialog).boxShadow.slice(0, 60);
    const kids = root.querySelectorAll("*");
    for (const kid of kids) if (kid.shadowRoot) walk(kid.shadowRoot);
  };
  walk(document);
  const gutter = getComputedStyle(document.documentElement).getPropertyValue("--pi-chat-gutter").trim();
  const elevation = getComputedStyle(document.documentElement).getPropertyValue("--pi-elevation-3").trim();
  return JSON.stringify({ ...out, gutter, elevation });
})()`);

console.log("desktop:", readings);

const typedMarks = await page.evaluate(`(function () {
  const found = [];
  const walk = (root) => {
    const nodes = root.querySelectorAll("button, span, a");
    for (const node of nodes) {
      const text = (node.textContent ?? "").trim();
      if (/^[✓✔✖✗⧉↻↩◌●○▶▸▾⚑☑⟲‹›ⓘ]$/u.test(text)) found.push((node.className || node.tagName) + ": " + text);
    }
    for (const kid of root.querySelectorAll("*")) if (kid.shadowRoot) walk(kid.shadowRoot);
  };
  walk(document);
  return JSON.stringify(found.slice(0, 10));
})()`);
console.log("standalone typed marks on screen:", typedMarks);

await browser.close();
