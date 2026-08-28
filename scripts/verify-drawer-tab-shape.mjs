/**
 * Live check that the drawer's section buttons share the shape language of the
 * controls around them, and stay legible at phone width.
 *
 * Usage: node scripts/verify-drawer-tab-shape.mjs [port]
 */
import { chromium, devices } from "@playwright/test";

const port = process.argv[2] ?? "8505";
const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const b = await chromium.launch({ executablePath: exe });
const ctx = await b.newContext({ ...devices["Pixel 5"], colorScheme: "dark" });
const p = await ctx.newPage();
const P = process.argv[3] ?? "b8f74304-f20d-43a3-80a0-ad698f90ddd9";
const W = process.argv[4] ?? "7a65a4a07e22";
const S = process.argv[5] ?? "01a02e5b-43b8-7d44-a672-2873ca900876";
await p.goto(`http://127.0.0.1:${port}/?project=${P}&workspace=${W}&session=${S}`, { waitUntil: "networkidle" });
await p.waitForTimeout(5000);

// The sections only exist once the session has activity, notifications or a
// goal, so a page without them proves nothing about their shape.
const opened = await p.evaluate(() => {
  const walk = (root) => {
    for (const el of root.querySelectorAll("button, summary, [role='button']")) {
      const label = `${el.getAttribute("aria-label") ?? ""} ${el.textContent ?? ""}`.toLowerCase();
      if (label.includes("activity") || label.includes("drawer") || label.includes("background run")) { el.click(); return true; }
    }
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot && walk(el.shadowRoot)) return true;
    return false;
  };
  return walk(document);
});
console.log("opened drawer:", opened);
await p.waitForTimeout(2500);

const seen = await p.evaluate(() => {
  const found = [];
  const walk = (root) => {
    for (const el of root.querySelectorAll("[role='tab']")) {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      found.push({
        text: (el.textContent ?? "").trim().slice(0, 18),
        h: Math.round(r.height),
        radius: s.borderTopLeftRadius,
        pill: parseFloat(s.borderTopLeftRadius) >= r.height / 2 - 1,
      });
    }
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot);
  };
  walk(document);
  return found;
});

if (seen.length === 0) {
  console.error("FAIL: no section buttons rendered, so their shape was not measured");
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(seen));
  const pills = seen.filter((tab) => tab.pill);
  if (pills.length > 0) {
    console.error(`FAIL: ${String(pills.length)} section button(s) still read as pills: ${pills.map((tab) => tab.text).join(", ")}`);
    process.exitCode = 1;
  } else console.log("PASS");
}
await ctx.close(); await b.close();
