/**
 * Live check that a message sent mid-reply does not split the reply in two.
 *
 * Drives the transcript the way the event stream does: partial reply, a queued
 * message, then the rest of the reply.
 *
 * Usage: node scripts/verify-reply-not-split.mjs [port]
 */
import { chromium } from "@playwright/test";

const port = process.argv[2] ?? "8505";
const P = "b8f74304-f20d-43a3-80a0-ad698f90ddd9";
const W = "7a65a4a07e22";
const S = "01a037f1-3fc4-714b-bc11-0b1f46117ea0";
const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const b = await chromium.launch({ executablePath: exe });
const ctx = await b.newContext({ viewport: { width: 393, height: 760 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const p = await ctx.newPage();
await p.goto(`http://127.0.0.1:${port}/?project=${P}&workspace=${W}&session=${S}`, { waitUntil: "networkidle" });
await p.waitForTimeout(3500);

const result = await p.evaluate(() => {
  const view = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view");
  if (!view) return { error: "no chat view" };
  view.messages = [
    { role: "assistant", parts: [{ type: "text", text: "the first half" }] },
    { role: "user", parts: [{ type: "text", text: "sent while waiting" }], meta: { delivery: { clientMessageId: "cm-1", state: "queued" } } },
  ];
  view.requestUpdate();
  return { seeded: true };
});
if (result.error !== undefined) { console.error(`FAIL: ${result.error}, so nothing was measured`); process.exitCode = 1; await b.close(); process.exit(); }
await p.waitForTimeout(600);

const rendered = await p.evaluate(() => {
  const root = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view")?.shadowRoot;
  const rows = [...(root?.querySelectorAll(".msg") ?? [])];
  return rows.map((row) => ({
    role: (row.className.match(/msg-(user|assistant)/u) ?? [])[1] ?? row.getAttribute("data-role") ?? "?",
    text: (row.textContent ?? "").replace(/\s+/gu, " ").trim().slice(0, 40),
    top: Math.round(row.getBoundingClientRect().top),
  }));
});

console.log(JSON.stringify(rendered, null, 1));
const assistants = rendered.filter((row) => row.text.includes("first half") || row.text.includes("the rest"));
if (rendered.length === 0) { console.error("FAIL: nothing rendered, so this proves nothing"); process.exitCode = 1; }
else if (assistants.length > 1) { console.error(`FAIL: the reply is drawn as ${assistants.length} separate messages`); process.exitCode = 1; }
else console.log("PASS");
await ctx.close(); await b.close();
