import { chromium } from "@playwright/test";

const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 850 }, deviceScaleFactor: 3 });

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  async function tapDeep(text) {
    const handle = await page.evaluateHandle((needle) => {
      function walk(root, out) {
        for (const node of root.querySelectorAll("*")) {
          if ((node.textContent ?? "").trim().startsWith(needle) && node.getBoundingClientRect().width > 0) out.push(node);
          if (node.shadowRoot) walk(node.shadowRoot, out);
        }
        return out;
      }
      const hits = walk(document, []);
      return hits[hits.length - 1] ?? null;
    }, text);
    const element = handle.asElement();
    if (element === null) return false;
    await element.click();
    await page.waitForTimeout(2500);
    return true;
  }

  if (!(await tapDeep("pi-web"))) console.log("note: could not open a project");
  await page.waitForTimeout(1500);
  const openedSession = await page.evaluate(() => {
    function walk(root, out) {
      for (const node of root.querySelectorAll("*")) {
        if (node.matches?.(".session-row, [data-session-id], .session-tile")) out.push(node);
        if (node.shadowRoot) walk(node.shadowRoot, out);
      }
      return out;
    }
    const rows = walk(document, []);
    const row = rows[0];
    if (row === undefined) return false;
    row.click();
    return true;
  });
  console.log(`opened a session row: ${String(openedSession)}`);
  if (!openedSession) await tapDeep("Long transcript turn 0");
  await page.waitForTimeout(5000);
  await page.evaluate(() => {
    function walk(root, out) {
      for (const node of root.querySelectorAll("*")) {
        if (node.matches?.(".chat")) out.push(node);
        if (node.shadowRoot) walk(node.shadowRoot, out);
      }
      return out;
    }
    const chat = walk(document, [])[0];
    if (chat !== undefined) chat.scrollTop = chat.scrollHeight;
  });
  await page.waitForTimeout(1500);

  const found = await page.evaluate(() => {
    function deepQueryAll(root, selector, out) {
      for (const node of root.querySelectorAll("*")) {
        if (node.matches?.(selector)) out.push(node);
        if (node.shadowRoot) deepQueryAll(node.shadowRoot, selector, out);
      }
      return out;
    }
    const headers = deepQueryAll(document, ".msg > .msg-header", []);
    if (headers.length === 0) return { count: 0 };
    const readings = headers.slice(0, 6).map((header) => {
      const card = header.parentElement;
      const cardStyle = getComputedStyle(card);
      const headerStyle = getComputedStyle(header);
      const cardBox = card.getBoundingClientRect();
      const headerBox = header.getBoundingClientRect();
      return {
        cardRadius: cardStyle.borderTopLeftRadius,
        cardBorder: cardStyle.borderTopWidth,
        headerRadius: headerStyle.borderTopLeftRadius,
        leftGap: Math.round((headerBox.left - cardBox.left) * 100) / 100,
        rightGap: Math.round((cardBox.right - headerBox.right) * 100) / 100,
      };
    });
    return { count: headers.length, readings };
  });

  if (found.count === 0) {
    fail("no message headers on screen; probe reached nothing and proves nothing");
  } else {
    console.log(`headers found: ${String(found.count)}`);
    for (const [index, r] of found.readings.entries()) {
      const card = Number.parseFloat(r.cardRadius);
      const border = Number.parseFloat(r.cardBorder);
      const header = Number.parseFloat(r.headerRadius);
      const expected = card - border;
      const ok = Math.abs(header - expected) < 0.5;
      console.log(`  header ${String(index)}: card ${r.cardRadius} border ${r.cardBorder} -> inner ${String(expected)}px; header ${r.headerRadius}; edges L${String(r.leftGap)} R${String(r.rightGap)} ${ok ? "OK" : "MISMATCH"}`);
      if (!ok) fail(`header ${String(index)} rounds ${String(header)}px where the card's inner corner is ${String(expected)}px`);
      // The header sits against the inside of the card's border, so its edges
      // are exactly one border-width in from the card's outer edge. Zero would
      // mean it overhangs the border; more than that means a gap.
      if (Math.abs(r.leftGap - border) > 0.5 || Math.abs(r.rightGap - border) > 0.5) {
        fail(`header ${String(index)} sits at L${String(r.leftGap)} R${String(r.rightGap)} where the ${String(border)}px border wants both`);
      }
    }
  }

  await page.screenshot({ path: "/tmp/card-corners.png", fullPage: false });
  console.log("screenshot: /tmp/card-corners.png");
} finally {
  await browser.close();
}
