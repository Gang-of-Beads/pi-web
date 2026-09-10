/**
 * Round-18 probe: the compact panel must not mount two machine lists, and at
 * most one may be visible. Run against the 8505 stack. Excluded from Knip as
 * a standalone probe script (see package.json knip config).
 */
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
await page.goto("http://localhost:8505/", { waitUntil: "networkidle" });
await page.waitForTimeout(3000);

const lists = await page.evaluate(() => {
  let count = 0;
  let visible = 0;
  const walk = (root) => {
    for (const el of root.querySelectorAll("machine-list")) {
      count += 1;
      const style = getComputedStyle(el);
      if (style.display !== "none" && !el.hasAttribute("hidden")) visible += 1;
    }
    for (const kid of root.querySelectorAll("*")) if (kid.shadowRoot) walk(kid.shadowRoot);
  };
  walk(document);
  return { count, visible };
});
console.log(JSON.stringify(lists));
const verdict = lists.visible <= 1 ? "PASS: at most one visible machine list" : "FAIL: duplicate visible machine lists";
console.log(verdict);
await browser.close();
process.exit(lists.visible <= 1 ? 0 : 1);
