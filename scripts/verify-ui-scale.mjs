/**
 * Live check that the interface-size slider changes the size of the interface.
 *
 * A settings control that writes a preference nothing reads is the failure
 * this exists to catch, so nothing here trusts the stored value: it measures a
 * rendered element before and after, and fails when the measurement does not
 * move. It also fails when the slider is missing, rather than passing an
 * assertion it never ran.
 *
 * Usage: node scripts/verify-ui-scale.mjs [origin]
 */
import { chromium } from "@playwright/test";

const origin = process.argv[2] ?? "http://127.0.0.1:8505";
const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const failures = [];
const fail = (message) => { failures.push(message); console.error(`FAIL: ${message}`); };

await page.goto(`${origin}/?settings=appearance`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

/** The slider lives inside two shadow roots, so it is reached by walking them. */
const sliderHandle = await page.evaluateHandle(() => {
  const walk = (root) => {
    const found = root.querySelector?.("input#ui-scale");
    if (found !== null && found !== undefined) return found;
    for (const element of root.querySelectorAll("*")) {
      if (element.shadowRoot === null) continue;
      const inner = walk(element.shadowRoot);
      if (inner !== undefined) return inner;
    }
    return undefined;
  };
  return walk(document);
});
const slider = sliderHandle.asElement();
if (slider === null || (await slider.evaluate((node) => node === undefined || node === null))) {
  fail("no interface-size slider in Settings > Appearance");
} else {
  // A content-sized label, not the app root: the root is 100% wide, so under
  // zoom it reports the same box while everything inside it grows.
  const measure = () => page.evaluate(() => {
    const walk = (root) => {
      const found = root.querySelector?.(".scale .follow-title");
      if (found !== null && found !== undefined) return found;
      for (const element of root.querySelectorAll("*")) {
        if (element.shadowRoot === null) continue;
        const inner = walk(element.shadowRoot);
        if (inner !== undefined) return inner;
      }
      return undefined;
    };
    const label = walk(document);
    return Math.round((label?.getBoundingClientRect().width ?? 0) * 100) / 100;
  });
  const readZoom = () => page.evaluate(() => document.documentElement.style.getPropertyValue("zoom"));

  const before = await measure();
  if (before <= 0) fail("the interface-size label has no measurable width; the panel did not render");

  await slider.evaluate((node) => {
    node.value = "1.3";
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(400);
  const afterZoom = await readZoom();
  const after = await measure();

  if (afterZoom !== "1.3") fail(`expected the document to carry zoom 1.3, got ${JSON.stringify(afterZoom)}`);
  // A real change moves this number by roughly the factor asked for; an
  // unchanged number means the preference reached nothing that draws.
  if (after < before * 1.2) fail(`interface size did not change: ${String(before)}px before, ${String(after)}px after`);

  const stored = await page.evaluate(() => window.localStorage.getItem("pi-web-app-scale"));
  if (stored !== "1.3") fail(`expected the size to be remembered as "1.3", got ${JSON.stringify(stored)}`);

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  const reloadedZoom = await readZoom();
  if (reloadedZoom !== "1.3") fail(`the size was not restored after a reload: zoom is ${JSON.stringify(reloadedZoom)}`);

  console.log(`label width ${String(before)}px -> ${String(after)}px, zoom ${afterZoom}, restored ${reloadedZoom}`);
}

await browser.close();
if (failures.length > 0) process.exitCode = 1;
else console.log("PASS: the interface-size slider resizes the interface and is remembered");
