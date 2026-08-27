/**
 * Live check that the drawer's sections stay reachable once it is expanded.
 *
 * Usage: node scripts/verify-drawer-tabs-stay.mjs [port]
 */
import { chromium, devices } from "@playwright/test";

const port = process.argv[2] ?? "8505";
const P = "b8f74304-f20d-43a3-80a0-ad698f90ddd9";
const W = "7a65a4a07e22";
const S = "01a037f1-3fc4-714b-bc11-0b1f46117ea0";
const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const b = await chromium.launch({ executablePath: exe });
const ctx = await b.newContext({ ...devices["Pixel 5"] });
const p = await ctx.newPage();
await p.goto(`http://127.0.0.1:${port}/?project=${P}&workspace=${W}&session=${S}`, { waitUntil: "networkidle" });
await p.waitForTimeout(3500);

const visibleTabs = async () => await p.evaluate(() => {
  const chat = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view")?.shadowRoot;
  return [...(chat?.querySelectorAll("[role='tab']") ?? [])]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth; })
    .map((el) => (el.textContent ?? "").trim().slice(0, 24));
});

const collapsed = await visibleTabs();
// One section cannot go missing among itself: the report is about several
// sections, one of which stops being reachable.
if (collapsed.length < 2) {
  console.error(`FAIL: only ${String(collapsed.length)} section here, so this instance cannot answer whether expanding hides the others`);
  process.exitCode = 1;
} else {
  const expanded = await p.evaluate(() => {
    const chat = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view")?.shadowRoot;
    const toggle = chat?.querySelector("[aria-expanded]");
    if (!toggle) return false;
    if (toggle.getAttribute("aria-expanded") === "false") toggle.click();
    return true;
  });
  if (!expanded) { console.error("FAIL: no drawer toggle found, so nothing was expanded"); process.exitCode = 1; }
  await p.waitForTimeout(900);
  const after = await visibleTabs();
  console.log(`收起时分区=${JSON.stringify(collapsed)}\n展开后分区=${JSON.stringify(after)}`);
  if (after.length < collapsed.length) {
    console.error(`FAIL: expanding the drawer hid ${String(collapsed.length - after.length)} of its ${String(collapsed.length)} sections`);
    process.exitCode = 1;
  } else console.log("PASS");
}
await ctx.close(); await b.close();
