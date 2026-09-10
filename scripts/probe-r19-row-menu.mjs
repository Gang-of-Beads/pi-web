/**
 * Round-19 probe: the quick switcher row menu must carry its computed fixed
 * placement. Standalone probe script (knip-ignored); run against 8505.
 */
import { chromium } from "playwright";

// Round-19 probe: the quick switcher's row menu must receive the computed
// fixed-position style (round-18 shipped it as a literal style="undefined").
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
await page.goto("http://localhost:8505/", { waitUntil: "networkidle" });
await page.waitForTimeout(3000);

const opened = await page.evaluate(() => {
  let toggles = [];
  const walk = (root) => {
    for (const el of root.querySelectorAll("button")) {
      const label = el.getAttribute("aria-label") ?? "";
      if (label.startsWith("Actions for ") && el.getBoundingClientRect().width > 0) toggles.push(el);
    }
    for (const kid of root.querySelectorAll("*")) if (kid.shadowRoot) walk(kid.shadowRoot);
  };
  walk(document);
  return toggles.length;
});
console.log("menu toggles found:", opened);
if (opened === 0) { console.log("FAIL: no session rows to open a menu on"); await browser.close(); process.exit(1); }

const style = await page.evaluate(() => {
  let hit = null;
  const walk = (root) => {
    for (const el of root.querySelectorAll("button")) {
      const label = el.getAttribute("aria-label") ?? "";
      if (hit === null && label.startsWith("Actions for ") && el.getClientRects().length > 0 && el.getBoundingClientRect().width > 0) hit = el;
    }
    for (const kid of root.querySelectorAll("*")) if (kid.shadowRoot) walk(kid.shadowRoot);
  };
  walk(document);
  hit.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
  return true;
});
await page.waitForTimeout(300);

const menu = await page.evaluate(() => {
  let menu = null;
  const walk = (root) => {
    for (const el of root.querySelectorAll(".row-menu, .action-menu-panel")) if (menu === null) menu = el;
    for (const kid of root.querySelectorAll("*")) if (kid.shadowRoot) walk(kid.shadowRoot);
  };
  walk(document);
  if (menu === null) return null;
  const styleAttr = menu.getAttribute("style") ?? "";
  const computed = getComputedStyle(menu);
  return { styleAttr: styleAttr.slice(0, 60), position: computed.position };
});
console.log(JSON.stringify(menu));
const ok = menu !== null && menu.styleAttr !== "undefined" && menu.styleAttr !== "" && menu.position === "fixed";
console.log(ok ? "PASS: row menu carries computed fixed placement" : "FAIL: row menu placement missing");
await browser.close();
process.exit(ok ? 0 : 1);
