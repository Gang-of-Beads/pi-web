/**
 * Live check that the list-only split rule reaches the page.
 *
 * The panels themselves need a session with a workspace to render, which this
 * preview instance does not have, so this checks the rule is delivered and
 * shaped as intended. Which pane is chosen is covered by the unit tests for
 * filesSplitClass and gitSplitClass.
 *
 * Usage: node scripts/verify-panel-split.mjs [viewportWidth]
 */
import { chromium } from "@playwright/test";

const W = Number(process.argv[2] ?? 320);
const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const b = await chromium.launch({ executablePath: exe });
const p = await b.newPage({ viewport: { width: W, height: 844 } });
await p.goto("http://127.0.0.1:8505/", { waitUntil: "networkidle" });
await p.waitForTimeout(2500);

const rules = await p.evaluate(() => {
  const found = [];
  const walk = (root) => {
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot === null) continue;
      for (const sheet of el.shadowRoot.adoptedStyleSheets ?? []) {
        for (const rule of sheet.cssRules) if (rule.cssText.includes("list-only")) found.push(rule.cssText);
      }
      walk(el.shadowRoot);
    }
  };
  walk(document);
  return [...new Set(found)];
});

console.log(`${W}px  list-only rules delivered: ${rules.length}`);
for (const rule of rules) console.log("  " + rule.slice(0, 96));
if (rules.length < 2) {
  console.error("FAIL: expected the list-only track and the hidden second pane");
  process.exitCode = 1;
}
await b.close();
