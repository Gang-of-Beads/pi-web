/**
 * Does a message header paint outside its message box?
 *
 * This decides whether content-visibility can go on `.msg` directly. That
 * property applies paint containment at all times, not only while a row is off
 * screen, so anything a message draws outside its own border box - the header's
 * negative margins, its shadow - would be clipped for every visible row too.
 *
 * Reasoning about it from the stylesheet was not conclusive, so this measures
 * the rendered result. It reports numbers; it asserts nothing.
 */
import { chromium, devices } from "playwright";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:8505";
const browser = await chromium.launch();
const page = await browser.newPage({ ...devices["Pixel 7"] });

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(2500);

  // Reach any session that has a transcript: open the first project, then the
  // first session in it.
  const opened = await page.evaluate(async () => {
    const click = (root, match) => {
      const visit = (node) => {
        for (const el of node.querySelectorAll("button, [role=button]")) {
          const text = (el.textContent ?? "").trim();
          if (match(text)) { el.click(); return true; }
        }
        for (const el of node.querySelectorAll("*")) if (el.shadowRoot && visit(el.shadowRoot)) return true;
        return false;
      };
      return visit(root);
    };
    const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });
    if (!click(document, (t) => t.startsWith("pi-web") && !t.includes("seed"))) return "no project tile";
    await wait(2500);
    if (!click(document, (t) => t.length > 3 && !t.startsWith("+") && !t.includes("Search"))) return "no session row";
    await wait(4000);
    return "opened";
  });

  await page.waitForTimeout(2500);

  const measured = await page.evaluate(() => {
    const found = [];
    const visit = (root) => {
      for (const msg of root.querySelectorAll("article.msg, details.msg")) {
        const header = msg.querySelector(".msg-header, summary");
        if (header === null) continue;
        const m = msg.getBoundingClientRect();
        const h = header.getBoundingClientRect();
        found.push({
          overflowTop: Math.round(m.top - h.top),
          overflowLeft: Math.round(m.left - h.left),
          overflowRight: Math.round(h.right - m.right),
          headerShadow: getComputedStyle(header).boxShadow.slice(0, 40),
        });
      }
      for (const el of root.querySelectorAll("*")) if (el.shadowRoot) visit(el.shadowRoot);
    };
    visit(document);
    return found.slice(0, 6);
  });

  console.log(`navigation: ${opened}`);
  console.log(`messages measured: ${measured.length}`);
  for (const m of measured) console.log(JSON.stringify(m));
  console.log("\npositive overflow* means the header paints outside the message box and paint containment would clip it");
  await page.screenshot({ path: "/tmp/review-8505/transcript.png" });
} catch (error) {
  console.log(`not reached: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await browser.close();
}
