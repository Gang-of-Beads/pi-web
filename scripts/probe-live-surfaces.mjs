import { chromium } from "@playwright/test";

const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const results = [];

function record(name, status, detail) {
  results.push({ name, status, detail });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 850 }, deviceScaleFactor: 2 });
const consoleErrors = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);

  const surfaces = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return { cardInnerRadius: styles.getPropertyValue("--pi-card-inner-radius").trim() };
  });
  record(
    "the card-inner-radius token reaches the browser",
    surfaces.cardInnerRadius === "" ? "check" : "ok",
    surfaces.cardInnerRadius === "" ? "token absent" : surfaces.cardInnerRadius,
  );

  const activityText = await page.evaluate(() => {
    function walk(root, out) {
      for (const node of root.querySelectorAll("*")) {
        if (node.matches?.(".activity-empty")) out.push(node);
        if (node.shadowRoot) walk(node.shadowRoot, out);
      }
      return out;
    }
    return walk(document, []).map((node) => (node.textContent ?? "").trim());
  });
  const claimsQuiet = activityText.some((text) => text === "Nothing running right now.");
  record(
    "the activity panel no longer claims the whole session is quiet",
    claimsQuiet ? "check" : "ok",
    activityText.length === 0 ? "panel not open on this surface" : activityText.join(" | "),
  );

  record("console", consoleErrors.length === 0 ? "ok" : "check", consoleErrors.slice(0, 3).join(" | ") || "clean");

  await page.screenshot({ path: "/tmp/live-surfaces.png" });
} finally {
  await browser.close();
}

let needsAttention = 0;
for (const result of results) {
  if (result.status !== "ok") needsAttention += 1;
  console.log(`[${result.status}] ${result.name}: ${result.detail}`);
}
console.log(`\n${String(results.length)} checks, ${String(needsAttention)} needing attention`);
process.exitCode = needsAttention === 0 ? 0 : 1;
