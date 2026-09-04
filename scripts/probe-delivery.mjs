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

  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("PAGE_" + m.type().toUpperCase(), m.text().slice(0, 200)); });
  page.on("pageerror", (e) => { console.log("PAGE_CRASH", String(e).slice(0, 300)); });
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
  const typeIntoComposer = async (text) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await focusComposer();
      await page.keyboard.type(text);
      await page.waitForTimeout(300);
      const draft = await page.evaluate(() => document.querySelector("pi-web-app")?.shadowRoot?.querySelector("prompt-editor")?.shadowRoot?.querySelector(".cm-content")?.textContent ?? "");
      if (draft.includes(text.slice(0, 12))) return true;
      await page.waitForTimeout(1200);
    }
    return false;
  };
  const typed = await typeIntoComposer("Run exactly this and nothing else: bash sleep 30. Do not reply before it finishes.");
  record("the busy prompt is in the composer", typed, `typed=${String(typed)}`);
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
  const captionTyped = await typeIntoComposer(CAPTION);
  record("the caption is in the composer", captionTyped, `typed=${String(captionTyped)}`);
  const attached = await page.evaluate(() => {
    const editor = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("prompt-editor");
    return (editor?.attachments?.length ?? 0) > 0 || (editor?.shadowRoot?.querySelectorAll(".attachment-chip, .attachment-preview").length ?? 0) > 0;
  });
  record("the photo is attached", attached, `attached=${String(attached)}`);
  await page.waitForFunction(() => {
    const editor = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("prompt-editor");
    return editor !== null && editor !== undefined && editor.attachingCount === 0;
  }, undefined, { timeout: 20000 }).catch(() => undefined);
  await clickSend();
  await page.waitForTimeout(2500);
  const postClick = await page.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    const editor = app?.shadowRoot?.querySelector("prompt-editor");
    const cm = editor?.shadowRoot?.querySelector(".cm-content");
    return {
      draftLeft: (cm?.textContent ?? "").slice(0, 40),
      messages: app?.state?.messages?.length,
      lastMsg: JSON.stringify(app?.state?.messages?.at(-1) ?? null).slice(0, 160),
      queued: app?.state?.status?.queuedMessages?.length,
      sending: JSON.stringify(app?.state?.sendingPrompts ?? {}),
    };
  });
  console.log("POST_CLICK", JSON.stringify(postClick));

  const countRows = (caption) => {
    function leaves(root, out) { for (const n of root.querySelectorAll("*")) { if (n.children.length === 0 && (n.textContent ?? "").includes(caption)) out.push(n); if (n.shadowRoot) leaves(n.shadowRoot, out); } return out; }
    function rowOf(node) {
      let current = node;
      while (current) {
        if (current.classList?.contains?.("msg")) return current;
        current = current.parentElement ?? current.getRootNode?.()?.host ?? null;
      }
      return null;
    }
    const found = leaves(document, []);
    const rows = new Set(found.map(rowOf).filter((row) => row !== null));
    return { rows: rows.size, text: [...rows][0]?.textContent?.slice(-60) ?? "", leaves: found.length };
  };
  const queuedView = await page.evaluate(countRows, CAPTION);
  record("the photo message is on screen once while queued", queuedView.rows === 1, `rows=${String(queuedView.rows)} tail=${JSON.stringify(queuedView.text.trim())}`);

  // Wait out the turn and the drain.
  let settled;
  for (let i = 0; i < 30; i += 1) {
    await page.waitForTimeout(5000);
    settled = await page.evaluate((caption) => {
      function leaves(root, out) { for (const n of root.querySelectorAll("*")) { if (n.children.length === 0 && (n.textContent ?? "").includes(caption)) out.push(n); if (n.shadowRoot) leaves(n.shadowRoot, out); } return out; }
      function rowOf(node) {
        let current = node;
        while (current) {
          if (current.classList?.contains?.("msg")) return current;
          current = current.parentElement ?? current.getRootNode?.()?.host ?? null;
        }
        return null;
      }
      const app = document.querySelector("pi-web-app");
      const rows = [...new Set(leaves(document, []).map(rowOf).filter((row) => row !== null))];
      const receipts = rows.map((n) => /Queued to steer|Queued|Read|Sent|Delivered/.exec(n.textContent ?? "")?.[0] ?? "none");
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
