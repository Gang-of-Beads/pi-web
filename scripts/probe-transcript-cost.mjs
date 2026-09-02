/**
 * What a long transcript costs to render, measured rather than assumed.
 *
 * Opens the heaviest session it can find and reports how long a forced layout
 * of the message list takes, how many rows exist, and how many the browser is
 * actually laying out. With content-visibility the row count stays the same
 * while the laid-out count drops, which is the whole point: the transcript is
 * still searchable and still anchors, it is simply not measured when off screen.
 *
 * Reports numbers and a screenshot. Asserts nothing.
 */
import { chromium, devices } from "@playwright/test";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:8505";
const label = process.argv[3] ?? "run";
const browser = await chromium.launch();
const page = await browser.newPage({ ...devices["Pixel 7"] });

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(2500);

  const opened = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });
    const clickText = (match) => {
      const visit = (node) => {
        for (const el of node.querySelectorAll("button, [role=button], article, li")) {
          if (match((el.textContent ?? "").trim())) { el.click(); return true; }
        }
        for (const el of node.querySelectorAll("*")) if (el.shadowRoot && visit(el.shadowRoot)) return true;
        return false;
      };
      return visit(document);
    };
    if (!clickText((t) => t.startsWith("pi-web") && !t.includes("seed"))) return "no project";
    await wait(3000);
    if (!clickText((t) => /\d{3,} messages/.test(t))) return "no heavy session";
    await wait(9000);
    return "opened";
  });

  const measured = await page.evaluate(() => {
    const findChat = (root) => {
      const direct = root.querySelector(".chat");
      if (direct !== null) return direct;
      for (const el of root.querySelectorAll("*")) if (el.shadowRoot) { const hit = findChat(el.shadowRoot); if (hit !== null) return hit; }
      return null;
    };
    const chat = findChat(document);
    if (chat === null) return { reached: false };
    const rows = chat.querySelectorAll("article.msg, details.msg");
    const started = performance.now();
    let laidOut = 0;
    for (const row of rows) if (row.getBoundingClientRect().height > 0) laidOut += 1;
    const walkMs = performance.now() - started;
    return { reached: true, rows: rows.length, laidOut, walkMs: Math.round(walkMs * 100) / 100, scrollHeight: chat.scrollHeight };
  });

  console.log(`navigation: ${opened}`);
  console.log(JSON.stringify(measured));
  await page.screenshot({ path: `/tmp/review-8505/cost-${label}.png` });
} catch (error) {
  console.log(`not reached: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await browser.close();
}
