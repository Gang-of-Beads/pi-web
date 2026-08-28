/**
 * Live check that an agent-run row opens the child's conversation.
 *
 * The regression this guards is specific: the click set state that nothing
 * rendered, so a row that used to open a block of text opened nothing at all.
 * A row is therefore clicked for real and the dialog is measured afterwards.
 *
 * Usage: node scripts/verify-child-conversation-opens.mjs [port]
 */
import { chromium } from "@playwright/test";

const PORT = process.argv[2] ?? "8505";
const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const DEEP_CLICK = (needle) => {
  const walk = (root, out = []) => {
    for (const el of root.querySelectorAll("button,[role=option],[role=listitem],li,[aria-label]")) out.push(el);
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot, out);
    return out;
  };
  const hit = walk(document).find((x) => `${x.getAttribute("aria-label") ?? ""} ${(x.textContent ?? "").trim()}`.toLowerCase().includes(needle.toLowerCase()));
  hit?.click();
  return hit !== undefined;
};

const browser = await chromium.launch({ executablePath: EXE });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  await page.evaluate(DEEP_CLICK, "pi-web/Users");
  await page.waitForTimeout(2000);
  await page.evaluate(DEEP_CLICK, "main");
  await page.waitForTimeout(2500);

  const sessionMessages = await page.evaluate(() => {
    const walk = (root, out = []) => {
      for (const el of root.querySelectorAll("button,[role=listitem],li")) out.push(el);
      for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot, out);
      return out;
    };
    const rows = walk(document)
      .map((el) => ({ el, count: Number(/(\d+)\s+messages/u.exec(el.textContent ?? "")?.[1] ?? 0) }))
      .filter((row) => row.count > 0)
      .sort((left, right) => right.count - left.count);
    rows[0]?.el.click();
    return rows[0]?.count ?? 0;
  });
  await page.waitForTimeout(9000);

  if (sessionMessages === 0) {
    console.error("FAIL: no conversation was opened, so no activity row was reachable");
    process.exitCode = 1;
  }

  // Open the activity drawer, then click a run row the way a reader would.
  await page.evaluate(DEEP_CLICK, "Activity");
  await page.waitForTimeout(2000);

  const clicked = await page.evaluate(() => {
    const walk = (root, out = []) => {
      for (const el of root.querySelectorAll(".subagent-row")) out.push(el);
      for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot, out);
      return out;
    };
    const rows = walk(document);
    const run = rows.find((el) => (el.className ?? "").includes("subagent-run") || el.getAttribute("data-run-id") !== null) ?? rows[0];
    if (run === undefined) return { found: false, rowCount: rows.length };
    run.click();
    return { found: true, rowCount: rows.length, label: (run.textContent ?? "").replace(/\s+/gu, " ").trim().slice(0, 60) };
  });
  await page.waitForTimeout(4000);

  const measured = await page.evaluate(() => {
    let dialog;
    const walk = (root) => {
      for (const el of root.querySelectorAll("dialog.activity-conversation")) dialog ??= el;
      for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot);
    };
    walk(document);
    if (dialog === undefined) return { dialogPresent: false };
    return {
      dialogPresent: true,
      open: dialog.open,
      title: dialog.querySelector(".activity-conversation-title")?.textContent?.trim(),
      subtitle: dialog.querySelector(".activity-conversation-subtitle")?.textContent?.trim(),
      boundary: dialog.querySelector(".activity-conversation-boundary")?.textContent?.trim(),
      messageRows: dialog.querySelectorAll(".activity-conversation-body article.msg").length,
      blobPresent: dialog.querySelector("pre") !== null,
      closePresent: dialog.querySelector(".activity-conversation-close") !== null,
    };
  });

  console.log("clicked:", JSON.stringify(clicked));
  console.log("dialog :", JSON.stringify(measured));

  if (!clicked.found) {
    console.error("FAIL: no activity row was found to click, so the click was not exercised");
    process.exitCode = 1;
  } else if (measured.dialogPresent !== true || measured.open !== true) {
    console.error("FAIL: clicking a run row did not open the conversation - this is the regression");
    process.exitCode = 1;
  } else if (measured.messageRows === 0) {
    console.error("FAIL: the conversation opened with no turns in it");
    process.exitCode = 1;
  } else if (measured.blobPresent) {
    console.error("FAIL: the run still rendered as a block of text");
    process.exitCode = 1;
  } else if (measured.boundary === undefined || measured.boundary === "") {
    console.error("FAIL: the view did not say that steering is unavailable here");
    process.exitCode = 1;
  } else if (measured.closePresent !== true) {
    console.error("FAIL: the view offered no way back");
    process.exitCode = 1;
  } else {
    console.log(`PASS  "${measured.title}" ${String(measured.messageRows)} turns, boundary stated, way back present`);
  }
} finally {
  await browser.close();
}
