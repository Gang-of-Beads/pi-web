import { chromium } from "@playwright/test";

const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const SESSION = "01a06835-8d26-7f50-ae73-a22d3b9fc00c";
const CWD = "/private/tmp/test";
const CAPTION = `chaos steer ${String(Date.now())}`;
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`[${ok ? "ok" : "FAIL"}] ${name}: ${detail}`);
}

async function post(path, body) {
  const answer = await fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return answer.status;
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 393, height: 850 } });
const page = await context.newPage();
try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    function walk(root, out, sel) { for (const n of root.querySelectorAll("*")) { if (n.matches?.(sel)) out.push(n); if (n.shadowRoot) walk(n.shadowRoot, out, sel); } return out; }
    walk(document, [], "button").find((n) => (n.textContent ?? "").trim().startsWith("test/private/tmp/test"))?.click();
  });
  await page.waitForTimeout(2000);
  await page.evaluate(() => { document.querySelector("pi-web-app")?.selectMainView?.("chat"); });
  await page.waitForTimeout(1500);

  const busyStatus = await post(`/api/sessions/${SESSION}/prompt`, { cwd: CWD, text: "Run the bash tool with exactly: sleep 25. Then reply done.", clientMessageId: `chaos-busy-${String(Date.now())}` });
  record("busy prompt accepted", busyStatus === 200, `status=${String(busyStatus)}`);
  await page.waitForTimeout(6000);

  await page.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    const cm = app?.shadowRoot?.querySelector("prompt-editor")?.shadowRoot?.querySelector(".cm-content");
    cm?.focus();
  });
  await page.keyboard.type(CAPTION);
  await page.evaluate(() => {
    const editor = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("prompt-editor");
    editor?.send?.(editor.canSteer ? "steer" : "followUp");
  });
  await page.waitForTimeout(1500);

  for (let cycle = 0; cycle < 3; cycle += 1) {
    await context.setOffline(true);
    await page.waitForTimeout(3000);
    await context.setOffline(false);
    await page.waitForTimeout(5000);
  }

  let final;
  for (let i = 0; i < 24; i += 1) {
    await page.waitForTimeout(5000);
    final = await page.evaluate((caption) => {
      function walk(root, out, sel) { for (const n of root.querySelectorAll("*")) { if (n.matches?.(sel)) out.push(n); if (n.shadowRoot) walk(n.shadowRoot, out, sel); } return out; }
      const app = document.querySelector("pi-web-app");
      const rows = walk(document, [], ".msg").filter((n) => (n.textContent ?? "").includes(caption));
      return {
        streaming: app?.state?.status?.isStreaming,
        pending: app?.state?.status?.pendingMessageCount,
        rows: rows.length,
        receipts: rows.map((n) => /Queued[^"<]*|Sending|Sent|Read|Not sent/.exec(n.textContent ?? "")?.[0]?.trim() ?? "none"),
      };
    }, CAPTION);
    if (final.streaming === false && final.pending === 0) {
      await page.waitForTimeout(6000);
      final = await page.evaluate((caption) => {
        function walk(root, out, sel) { for (const n of root.querySelectorAll("*")) { if (n.matches?.(sel)) out.push(n); if (n.shadowRoot) walk(n.shadowRoot, out, sel); } return out; }
        const app = document.querySelector("pi-web-app");
        const rows = walk(document, [], ".msg").filter((n) => (n.textContent ?? "").includes(caption));
        return { streaming: app?.state?.status?.isStreaming, pending: app?.state?.status?.pendingMessageCount, rows: rows.length, receipts: rows.map((n) => /Queued[^"<]*|Sending|Sent|Read|Not sent/.exec(n.textContent ?? "")?.[0]?.trim() ?? "none") };
      }, CAPTION);
      break;
    }
  }
  record("exactly one row after three offline cycles", final !== undefined && final.rows === 1, JSON.stringify(final));
  const stuck = final?.receipts.some((receipt) => receipt.startsWith("Queued")) === true;
  record("receipt settled, not stuck at Queued", !stuck, JSON.stringify(final?.receipts));

  const daemon = await fetch(`${BASE}/api/sessions/${SESSION}/messages?cwd=${encodeURIComponent(CWD)}`).then((answer) => answer.json());
  const copies = daemon.messages.filter((message) => {
    const content = message.content;
    const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((part) => part.text ?? "").join(" ") : "";
    return text.includes(CAPTION) && message.role === "user";
  });
  record("daemon holds exactly one copy", copies.length === 1, `copies=${String(copies.length)}`);
  await page.screenshot({ path: "/tmp/probe-chaos-final.png" });
} finally {
  await browser.close();
}

const failed = results.filter((result) => !result.ok).length;
console.log(`\n${String(results.length)} checks, ${String(failed)} failing`);
process.exitCode = failed === 0 ? 0 : 1;
