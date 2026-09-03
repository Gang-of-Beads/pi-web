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

  // The corner fix is structural now: the card clips, nothing depends on a
  // token in the shell. What remains checkable here is that no stale rule
  // reintroduces the token dependency.
  const surfaces = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return { staleToken: styles.getPropertyValue("--pi-card-inner-radius").trim() };
  });
  record(
    "no shell token carries corner geometry any more",
    surfaces.staleToken === "" ? "ok" : "check",
    surfaces.staleToken === "" ? "clean" : `still defined: ${surfaces.staleToken}`,
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
  // An unreachable panel is not a pass: it is a check the probe could not
  // make, and reporting it as ok would let the claim survive unverified.
  record(
    "the activity panel no longer claims the whole session is quiet",
    activityText.length === 0 ? "check" : claimsQuiet ? "check" : "ok",
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
