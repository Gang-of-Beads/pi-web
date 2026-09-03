import { chromium } from "@playwright/test";

// The eleventh-report path, end to end on a live stack: a captioned oversized
// photo sent while the agent is busy must queue, drain, and end as exactly one
// row whose receipt settles - not two rows, not a receipt stuck at Queued.
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const CAPTION = `photo while busy ${String(Date.now())}`;
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`[${ok ? "ok" : "FAIL"}] ${name}: ${detail}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 850 } });
try {
  // An oversized photo, so the daemon re-encodes it and no byte survives:
  // content matching cannot claim this one, only the stamped id can.
  const photo = await browser.newPage({ viewport: { width: 2200, height: 2200 } });
  await photo.setContent("<body style='margin:0;background:linear-gradient(45deg,#e8643c,#2b241e)'><h1 style='color:#fff;font-size:120px;padding:80px'>probe photo</h1></body>");
  await photo.screenshot({ path: "/tmp/probe-oversized.png" });
  await photo.close();

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  // Select the test project, then a session.
  await page.evaluate(() => {
    function walk(root, out, sel) { for (const n of root.querySelectorAll("*")) { if (n.matches?.(sel)) out.push(n); if (n.shadowRoot) walk(n.shadowRoot, out, sel); } return out; }
    walk(document, [], "button").find((n) => (n.textContent ?? "").trim().startsWith("test/private/tmp/test"))?.click();
  });
  await page.waitForTimeout(2500);
  const sessionOpened = await page.evaluate(() => {
    function walk(root, out, sel) { for (const n of root.querySelectorAll("*")) { if (n.matches?.(sel)) out.push(n); if (n.shadowRoot) walk(n.shadowRoot, out, sel); } return out; }
    const app = document.querySelector("pi-web-app");
    if (app?.state?.selectedSession !== undefined) return "already";
    const row = walk(document, [], "button, [role='button']").find((n) => /session/i.test(n.className ?? "") && n.getBoundingClientRect().height > 0);
    if (row) { row.click(); return "clicked"; }
    return null;
  });
  await page.waitForTimeout(2500);
  const haveSession = await page.evaluate(() => document.querySelector("pi-web-app")?.state?.selectedSession?.id ?? null);
  record("a session is open", haveSession !== null, `session=${String(haveSession)} via ${String(sessionOpened)}`);
  if (haveSession === null) throw new Error("no session - probe cannot continue");

  // The composer is a CodeMirror editor inside two shadow roots; type into
  // its contenteditable surface. On the mobile layout the chat view owns it.
  const focusComposer = async () => {
    await page.evaluate(() => {
      const app = document.querySelector("pi-web-app");
      // The mobile layout hides the composer behind the navigation view.
      app?.selectMainView?.("chat");
      const cm = app?.shadowRoot?.querySelector("prompt-editor")?.shadowRoot?.querySelector(".cm-content");
      if (cm instanceof HTMLElement) cm.focus();
    });
    await page.waitForTimeout(400);
  };
  const clickSend = async () => {
    await page.evaluate(() => {
      const editor = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("prompt-editor");
      const send = editor?.shadowRoot?.querySelector(".send-button");
      if (send instanceof HTMLElement) send.click();
    });
  };
  await focusComposer();
  await page.keyboard.type("Run exactly this and nothing else: bash sleep 30. Do not reply before it finishes.");
  await clickSend();
  await page.waitForTimeout(6000);
  const busy = await page.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    return app?.state?.status?.isStreaming === true;
  });
  record("the agent is busy", busy, `isStreaming=${String(busy)}`);

  // The photo message, sent into the running turn.
  const fileInput = await page.evaluateHandle(() => document.querySelector("pi-web-app")?.shadowRoot?.querySelector("prompt-editor")?.shadowRoot?.querySelector(".attachment-input") ?? null);
  await fileInput.asElement().setInputFiles("/tmp/probe-oversized.png");
  await page.waitForTimeout(1500);
  await focusComposer();
  await page.keyboard.type(CAPTION);
  await clickSend();
  await page.waitForTimeout(2500);

  const queuedView = await page.evaluate((caption) => {
    function walk(root, out, sel) { for (const n of root.querySelectorAll("*")) { if (n.matches?.(sel)) out.push(n); if (n.shadowRoot) walk(n.shadowRoot, out, sel); } return out; }
    const rows = walk(document, [], ".msg").filter((n) => (n.textContent ?? "").includes(caption));
    return { rows: rows.length, text: rows[0]?.textContent?.slice(-60) ?? "" };
  }, CAPTION);
  record("the photo message is on screen once while queued", queuedView.rows === 1, `rows=${String(queuedView.rows)} tail=${JSON.stringify(queuedView.text.trim())}`);

  // Wait out the turn and the drain.
  let settled;
  for (let i = 0; i < 30; i += 1) {
    await page.waitForTimeout(5000);
    settled = await page.evaluate((caption) => {
      function walk(root, out, sel) { for (const n of root.querySelectorAll("*")) { if (n.matches?.(sel)) out.push(n); if (n.shadowRoot) walk(n.shadowRoot, out, sel); } return out; }
      const app = document.querySelector("pi-web-app");
      const rows = walk(document, [], ".msg").filter((n) => (n.textContent ?? "").includes(caption));
      const receipts = rows.map((n) => /Queued to steer|Queued|Sent|Delivered/.exec(n.textContent ?? "")?.[0] ?? "none");
      return { streaming: app?.state?.status?.isStreaming === true, pending: app?.state?.status?.pendingMessageCount ?? 0, rows: rows.length, receipts };
    }, CAPTION);
    if (!settled.streaming && settled.pending === 0) break;
  }
  record(
    "after the drain the photo message is exactly one row",
    settled !== undefined && settled.rows === 1,
    `rows=${String(settled?.rows)} receipts=${JSON.stringify(settled?.receipts)} streaming=${String(settled?.streaming)}`,
  );
  const stuck = settled?.receipts.some((receipt) => receipt.startsWith("Queued")) === true;
  record("its receipt is not stuck at Queued", !stuck, `receipts=${JSON.stringify(settled?.receipts)}`);
  await page.screenshot({ path: "/tmp/probe-delivery-final.png" });
} finally {
  await browser.close();
}

const failed = results.filter((result) => !result.ok).length;
console.log(`\n${String(results.length)} checks, ${String(failed)} failing`);
process.exitCode = failed === 0 ? 0 : 1;
