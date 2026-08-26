/**
 * Live check on the height of a message header, and on the sticky offset that
 * depends on it.
 *
 * The header carries one line of small text - the role label and the meta line
 * - inside a bar that reserved 22px of content plus 14px of padding, so every
 * message spent ~45px of vertical space before its first word. It read as a
 * title bar rather than a label.
 *
 * The offset is the reason this is measured rather than eyeballed. The header
 * is `position: sticky` with a negative `top`, so the visible sliver while
 * stuck is (header height + top). Shrinking the header without adjusting the
 * offset silently eats the label: the same edit that makes the bar shorter can
 * make the stuck label disappear. Both are asserted here.
 *
 * Usage:
 *   node scripts/verify-message-header.mjs [--base-url http://127.0.0.1:8505]
 */
import { chromium } from "@playwright/test";

const baseUrl = process.argv.includes("--base-url")
  ? process.argv[process.argv.indexOf("--base-url") + 1]
  : "http://127.0.0.1:8505";

const MAX_HEADER_HEIGHT = 30;
const MIN_STUCK_SLIVER = 6;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
const failures = [];
try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("pi-web-app", { timeout: 20_000 });

  await page.evaluate(() => {
    const host = document.createElement("div");
    host.style.cssText = "display:flex;flex-direction:column;height:100dvh;width:100%;box-sizing:border-box";
    host.id = "msg-header-probe-host";
    const el = document.createElement("chat-view");
    el.sessionId = "probe";
    el.messages = [
      { role: "assistant", parts: [{ type: "text", text: "first" }] },
      { role: "assistant", parts: [{ type: "text", text: `long ${"body ".repeat(400)}` }] },
    ];
    host.append(el);
    document.body.append(host);
  });
  await page.waitForTimeout(800);

  const measured = await page.evaluate(() => {
    const view = document.querySelector("#msg-header-probe-host chat-view");
    const root = view?.shadowRoot;
    const msg = root?.querySelectorAll("article.msg")?.[1];
    const header = msg?.querySelector(".msg-header");
    if (!msg || !header) return null;
    const style = getComputedStyle(header);
    const top = Number.parseFloat(style.top);
    const height = header.getBoundingClientRect().height;
    const label = header.querySelector(".label");
    return {
      height: Math.round(height),
      stickyTop: Number.isNaN(top) ? null : Math.round(top),
      stuckSliver: Number.isNaN(top) ? null : Math.round(height + top),
      labelText: label?.textContent?.trim() ?? "",
      position: style.position,
    };
  });

  if (measured === null) {
    failures.push("could not mount a chat-view message header");
  } else {
    if (measured.height > MAX_HEADER_HEIGHT) {
      failures.push(`header is ${String(measured.height)}px tall, expected <= ${String(MAX_HEADER_HEIGHT)}px`);
    }
    if (measured.position !== "sticky") {
      failures.push(`header position is ${measured.position}, expected sticky`);
    }
    if (measured.stuckSliver !== null && measured.stuckSliver < MIN_STUCK_SLIVER) {
      failures.push(
        `only ${String(measured.stuckSliver)}px of the header stays visible when stuck `
        + `(height ${String(measured.height)} + top ${String(measured.stickyTop)}); `
        + `expected >= ${String(MIN_STUCK_SLIVER)}px so the role label survives`,
      );
    }
    if (measured.labelText === "") {
      failures.push("header has no role label");
    }
    console.log(
      `header height=${String(measured.height)}px top=${String(measured.stickyTop)}px `
      + `stuck-sliver=${String(measured.stuckSliver)}px label=${JSON.stringify(measured.labelText)}`,
    );
  }
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.error("FAIL");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("PASS");
