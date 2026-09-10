import { chromium } from "playwright";

// Round-20 probe: the QUICK SWITCHER's row menu must carry its computed fixed
// placement. Round 19's probe verified the machine list's menu instead - this
// one opens the quick switcher surface itself.
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
await page.goto("http://localhost:8505/", { waitUntil: "networkidle" });
await page.waitForTimeout(3000);

const openSwitcher = await page.evaluate(() => {
  let hit = null;
  const walk = (root) => {
    for (const el of root.querySelectorAll("button, [role=button]")) {
      const label = (el.getAttribute("aria-label") ?? "") + " " + (el.textContent ?? "");
      if (hit === null && label.includes("Open session selection") && el.getBoundingClientRect().width > 0) hit = el;
    }
    for (const kid of root.querySelectorAll("*")) if (kid.shadowRoot) walk(kid.shadowRoot);
  };
  walk(document);
  if (hit === null) return false;
  hit.click();
  return true;
});
console.log("quick switcher opened:", openSwitcher);
await page.waitForTimeout(1200);

// find the first visible "Actions for" toggle by walking shadow roots, then
// click it with a real pointer event
const toggleInfo = await page.evaluate(() => {
  let path = null;
  const walk = (root, trail) => {
    for (const el of root.querySelectorAll("button")) {
      const label = el.getAttribute("aria-label") ?? "";
      if (path === null && label.startsWith("Actions for ") && el.getBoundingClientRect().width > 0) {
        path = [...trail, el];
      }
    }
    for (const kid of root.querySelectorAll("*")) if (kid.shadowRoot) walk(kid.shadowRoot, [...trail, kid]);
  };
  walk(document, []);
  return path === null ? null : path.length;
});
console.log("toggle found at shadow depth:", toggleInfo);
if (toggleInfo === null) { console.log("FAIL: no rows inside the quick switcher"); await browser.close(); process.exit(1); }
// click through the real input pipeline
await page.locator('quick-switcher').first().evaluate((el) => el.shadowRoot.querySelector("button[aria-label^='Actions for']")?.click());

const menu = await page.evaluate(() => {
  let menu = null;
  const walk = (root) => {
    for (const el of root.querySelectorAll(".row-menu")) if (menu === null) menu = el;
    for (const kid of root.querySelectorAll("*")) if (kid.shadowRoot) walk(kid.shadowRoot);
  };
  walk(document);
  if (menu === null) {
    const candidates = [];
    const walk2 = (root) => { for (const el of root.querySelectorAll("[role=menu], [class*=menu]")) candidates.push(el.className); for (const kid of root.querySelectorAll("*")) if (kid.shadowRoot) walk2(kid.shadowRoot); };
    walk2(document);
    return { candidates: candidates.slice(0, 8) };
  }
  return {
    styleAttr: (menu.getAttribute("style") ?? "").slice(0, 60),
    position: getComputedStyle(menu).position,
  };
});
console.log(JSON.stringify(menu));
const ok = menu !== null && menu.styleAttr !== "undefined" && menu.styleAttr !== "" && menu.position === "fixed";
console.log(ok ? "PASS: quick switcher row menu carries computed fixed placement" : "FAIL: placement missing on the quick switcher's own menu");
await browser.close();
process.exit(ok ? 0 : 1);
