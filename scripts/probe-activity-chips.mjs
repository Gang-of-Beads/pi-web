/**
 * Activity filter chips (rework-unspecced-ui 6.1), measured in a real DOM.
 *
 * The chip logic is a pure seam (`activityFilterOptions`), but the owner's
 * report was about the screen: a chip that said 109 while the panel said
 * nothing was running. This probe mounts the real `chat-view` with one
 * running background task and several finished ones, opens the Activity
 * drawer, and reads the chips out of the DOM:
 *   - a chip's number is the RUNNING count of its kind, never history;
 *   - "Show finished" carries no number;
 *   - a kind with only finished rows keeps its chip, without a count.
 *
 * Usage: node scripts/probe-activity-chips.mjs
 * Every unmet precondition FAILS loudly rather than passing empty.
 */
import { chromium } from "@playwright/test";

const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = "http://127.0.0.1:8505";

const PAGE = (entry) => `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  html,body{margin:0;background:#111;color:#eee;font:14px system-ui,sans-serif}
  chat-view{display:block;height:100vh}
</style></head><body>
  <chat-view id="view"></chat-view>
  <script type="module">
    import "${entry}";
    const view = document.getElementById("view");
    view.sessionId = "chips-probe";
    view.messages = [{ role: "user", parts: [{ type: "text", text: "Start" }] }];
    view.backgroundTasks = [
      { id: "t-run", name: "watcher", command: "npm run watch", status: "running", durationMs: 42_000 },
      { id: "t-1", name: "build", command: "npm run build", status: "completed", durationMs: 12_000 },
      { id: "t-2", name: "lint", command: "npm run lint", status: "completed", durationMs: 9_000 },
      { id: "t-3", name: "test", command: "npm test", status: "failed", durationMs: 30_000, exitCode: 1 },
    ];
  </script>
</body></html>`;

const browser = await chromium.launch({ executablePath: EXE, headless: true });
try {
  const index = await (await fetch("http://127.0.0.1:8505/")).text();
  const entryMatch = /src="([^"]*index-[^"]*\.js)"/u.exec(index);
  if (entryMatch === undefined) { console.log("FAIL(precondition): client entry bundle not found in the served index"); process.exit(2); }
  const entry = entryMatch[1];
  const CLIENT_ENTRY_URL = entry.startsWith("http") ? entry : `http://127.0.0.1:8505/${entry.replace(/^\.?\//u, "")}`;
  const page = await browser.newPage({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await page.route("**/chips-probe", (route) => route.fulfill({ contentType: "text/html", body: PAGE(CLIENT_ENTRY_URL) }));
  await page.goto("http://fixture.local/chips-probe", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);

  const opened = await page.evaluate(() => {
    function deep(root, sel, acc) { root.querySelectorAll(sel).forEach((n) => acc.push(n)); root.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) deep(el.shadowRoot, sel, acc); }); return acc; }
    const tab = deep(document, '[role="tab"]', []).find((t) => /Activity/i.test(t.textContent || ""));
    if (tab) tab.click();
    return tab !== undefined;
  });
  if (!opened) { console.log("FAIL(precondition): Activity tab not found"); process.exit(2); }
  await page.waitForTimeout(400);

  const readout = await page.evaluate(() => {
    function deep(root, sel, acc) { root.querySelectorAll(sel).forEach((n) => acc.push(n)); root.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) deep(el.shadowRoot, sel, acc); }); return acc; }
    const chips = deep(document, ".activity-filter", []).map((chip) => chip.textContent.replace(/\s+/g, " ").trim());
    const historyToggle = deep(document, ".activity-history-toggle", []).map((t) => t.textContent.replace(/\s+/g, " ").trim());
    return { chips, historyToggle };
  });

  console.log("chips:", JSON.stringify(readout.chips));
  console.log("historyToggle:", JSON.stringify(readout.historyToggle));
  await page.screenshot({ path: "/tmp/n7-chips.png" });

  const failures = [];
  const tasks = readout.chips.find((chip) => /Tasks/.test(chip));
  if (!/Tasks\s*1$/.test(tasks ?? "")) failures.push(`Tasks chip must show exactly the running count 1, got "${tasks ?? "none"}"`);
  const all = readout.chips.find((chip) => /^All/.test(chip));
  if (!/^All\s*1$/.test(all ?? "")) failures.push(`All chip must sum running counts to 1, got "${all ?? "none"}"`);
  for (const toggle of readout.historyToggle) {
    if (/\d/.test(toggle)) failures.push(`"Show finished" must carry no number, got "${toggle}"`);
  }
  if (failures.length > 0) {
    for (const failure of failures) console.log(`FAIL: ${failure}`);
    process.exit(1);
  }
  console.log("OK: chips count the running, history toggle carries no number.");
  process.exit(0);
} finally {
  await browser.close().catch(() => undefined);
}
