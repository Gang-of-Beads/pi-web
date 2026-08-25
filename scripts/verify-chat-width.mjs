/**
 * Live check that the composer shares the transcript's reading column.
 *
 * The bug this exists for: the message column is bounded to a readable
 * measure (`max-width: min(100%, 78ch)`) and centred, but the margin that
 * centres it was written as `.chat > * { margin-inline: auto }` followed by
 * `.msg { margin: 0 0 X }` with equal specificity, so the shorthand
 * silently won and every wide-screen transcript sat pinned to the left edge
 * while the composer stayed full-width - two unrelated columns. Unit tests
 * cannot catch layout: this measures a real chat-view and prompt-editor on
 * a wide viewport and asserts the message column and the editor share one
 * left edge (and that the send button survives the narrower footer).
 *
 * Usage:
 *   node scripts/verify-chat-width.mjs [--base-url http://127.0.0.1:8511]
 */
import { chromium } from "@playwright/test";

const baseUrl = process.argv.includes("--base-url")
  ? process.argv[process.argv.indexOf("--base-url") + 1]
  : "http://127.0.0.1:8511";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const failures = [];
try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("pi-web-app", { timeout: 20_000 });

  await page.evaluate(() => {
    const host = document.createElement("div");
    host.style.cssText = "display:flex;flex-direction:column;height:100dvh;width:100%;box-sizing:border-box";
    host.id = "chat-width-probe-host";
    const el = document.createElement("chat-view");
    el.sessionId = "probe";
    el.messages = [
      { role: "user", parts: [{ type: "text", text: "hello" }] },
      { role: "assistant", parts: [{ type: "text", text: "lorem ipsum dolor sit amet consectetur adipiscing elit" }] },
    ];
    const composer = document.createElement("prompt-editor");
    host.append(el, composer);
    document.body.append(host);
  });
  await page.waitForTimeout(800);

  const measured = await page.evaluate(() => {
    const host = document.querySelector("#chat-width-probe-host");
    const msg = host?.querySelector("chat-view")?.shadowRoot?.querySelector("article.msg");
    const footer = host?.querySelector("prompt-editor")?.shadowRoot?.querySelector("footer");
    const editor = footer?.querySelector(".editor-wrap");
    const send = footer?.querySelector(".send-button");
    if (!msg || !footer || !editor || !send) return null;
    const msgRect = msg.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    const sendRect = send.getBoundingClientRect();
    return {
      msgLeft: Math.round(msgRect.left),
      editorLeft: Math.round(editorRect.left),
      msgRight: Math.round(msgRect.right),
      editorRight: Math.round(editorRect.right),
      sendVisible: sendRect.width > 0 && sendRect.height > 0,
      sendInFooter: sendRect.right <= footer.getBoundingClientRect().right + 1,
    };
  });

  if (measured === null) {
    failures.push("could not mount chat-view + prompt-editor");
  } else {
    const leftGap = Math.abs(measured.msgLeft - measured.editorLeft);
    const rightGap = Math.abs(measured.msgRight - measured.editorRight);
    if (leftGap > 1 || rightGap > 1) {
      failures.push(
        `message column and composer are not one column (msg ${measured.msgLeft}..${measured.msgRight}, ` +
          `editor ${measured.editorLeft}..${measured.editorRight})`,
      );
    }
    if (!measured.sendVisible || !measured.sendInFooter) {
      failures.push("send button is clipped or pushed out of the footer by the reading column");
    }
  }
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.error(failures.map((f) => `FAIL: ${f}`).join("\n"));
  process.exit(1);
}
console.log("PASS: composer shares the transcript's reading column");