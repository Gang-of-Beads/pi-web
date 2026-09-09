import { chromium } from "@playwright/test";

const BASE = process.env.TOUCH_BASE ?? "http://127.0.0.1:8505";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3200);

const boot = await page.evaluate(`(function () {
  const rows = [];
  const walk = (root) => {
    for (const node of root.querySelectorAll(".compact-header, .context-bar, .section-title, .list-search-input, .action-main, .action-name, .action-main small, .compact-scope-name, .compact-header-action")) {
      const box = node.getBoundingClientRect();
      if (box.width === 0) continue;
      const style = getComputedStyle(node);
      rows.push({
        cls: (node.getAttribute("class") ?? node.tagName).slice(0, 28),
        x: Math.round(box.left), w: Math.round(box.width), h: Math.round(box.height),
        font: style.fontSize, weight: style.fontWeight,
        clipped: node.scrollWidth > node.clientWidth + 1 ? node.scrollWidth - node.clientWidth : 0,
      });
    }
    for (const kid of root.querySelectorAll("*")) if (kid.shadowRoot) walk(kid.shadowRoot);
  };
  walk(document);
  return JSON.stringify(rows.slice(0, 40));
})()`);
console.log("BOOT/SESSIONS:");
for (const row of JSON.parse(boot)) console.log("  ", JSON.stringify(row));

await page.evaluate(`(function () {
  let gear = null;
  const walk = (root) => {
    for (const node of root.querySelectorAll(".header-icon-action")) if (gear === null) gear = node;
    for (const kid of root.querySelectorAll("*")) if (kid.shadowRoot) walk(kid.shadowRoot);
  };
  walk(document);
  if (gear !== null) gear.click();
})()`);
await page.waitForTimeout(1500);

const settings = await page.evaluate(`(function () {
  const rows = [];
  const walk = (root) => {
    for (const node of root.querySelectorAll(".settings-list button, .settings-list button strong, .settings-list button small, .settings-title, header h2, .eyebrow")) {
      const box = node.getBoundingClientRect();
      if (box.width === 0) continue;
      const style = getComputedStyle(node);
      rows.push({
        cls: (node.getAttribute("class") ?? node.tagName).slice(0, 24),
        text: (node.textContent ?? "").trim().slice(0, 18),
        x: Math.round(box.left), h: Math.round(box.height),
        font: style.fontSize, weight: style.fontWeight, gap: style.rowGap,
      });
    }
    for (const kid of root.querySelectorAll("*")) if (kid.shadowRoot) walk(kid.shadowRoot);
  };
  walk(document);
  return JSON.stringify(rows.slice(0, 24));
})()`);
console.log("SETTINGS:");
for (const row of JSON.parse(settings)) console.log("  ", JSON.stringify(row));

await browser.close();
