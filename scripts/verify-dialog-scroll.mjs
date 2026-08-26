/**
 * Live check that a long extension dialog stays on screen.
 *
 * The bug this exists for: the goal plugin lists tasks and contracts in a
 * confirm dialog, and the card grew with the message, so the Yes/No buttons
 * ended four thousand pixels below a phone viewport - unreachable. The card's
 * detail body bounded its height, but the message and options lists did not.
 * Unit tests cannot catch layout: this mounts a real chat-view with a long
 * confirm/select/ask dialog and asserts the answer controls fit in the window.
 *
 * Usage:
 *   node scripts/verify-dialog-scroll.mjs [--base-url http://127.0.0.1:8511]
 */
import { chromium } from "@playwright/test";

const baseUrl = process.argv.includes("--base-url")
  ? process.argv[process.argv.indexOf("--base-url") + 1]
  : "http://127.0.0.1:8511";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true });
const failures = [];
try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("pi-web-app", { timeout: 20_000 });

  await page.evaluate(() => {
    const host = document.createElement("div");
    host.style.cssText = "display:flex;flex-direction:column;height:100dvh;width:100%;box-sizing:border-box";
    host.id = "dialog-probe-host";
    const el = document.createElement("chat-view");
    el.sessionId = "probe";
    el.messages = [{ role: "user", parts: [{ type: "text", text: "hi" }] }];
    const longPlan = Array.from({ length: 60 }, (_, i) => `t${i}: implement fix for finding #${i}\n  contract: reproduced before any change, verified by e2e, build stays green.`).join("\n");
    el.pendingDialogs = [{ dialogId: "d1", kind: "confirm", title: "Confirm goal: finish the remaining review findings and publish the fixes", message: longPlan }];
    host.append(el);
    document.body.append(host);
  });
  await page.waitForTimeout(800);

  const metrics = await page.evaluate(() => {
    const el = document.querySelector("chat-view");
    const card = el?.shadowRoot?.querySelector("extension-dialog-card.open-dialog-card");
    const yes = card === undefined || card === null
      ? undefined
      : [...card.shadowRoot.querySelectorAll("button")].find((button) => button.textContent.trim() === "Yes");
    if (card === undefined || card === null || yes === undefined) return { missing: true };
    const yesRect = yes.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const innerScrollers = [...card.shadowRoot.querySelectorAll("*")].filter((node) => {
      const style = getComputedStyle(node);
      const scrolls = style.overflowY === "auto" || style.overflowY === "scroll";
      return scrolls && node.scrollHeight > node.clientHeight + 1;
    }).length;
    return {
      winH: window.innerHeight,
      cardBottom: cardRect.bottom,
      yesTop: yesRect.top,
      yesBottom: yesRect.bottom,
      innerScrollers,
    };
  });

  if (metrics.missing === true) failures.push("confirm card did not render");
  else {
    if (metrics.yesBottom > metrics.winH) {
      failures.push(`confirm buttons below the fold: yesBottom=${Math.round(metrics.yesBottom)} > winH=${metrics.winH}`);
    }
    // The card may be taller than the window: it lives in the transcript, which
    // is the scroller. What must hold is that the answer controls stay in the
    // viewport (sticky footer) and that the card adds no scroller of its own -
    // a second scroll region inside the first is what made reading the plan
    // jump between contexts.
    if (metrics.innerScrollers > 0) {
      failures.push(`confirm card nests ${metrics.innerScrollers} inner scroll region(s) inside the transcript`);
    }
  }

  // Same for a long select list: every option is a choice someone must reach.
  await page.evaluate(() => {
    const el = document.querySelector("chat-view");
    if (el === null) return;
    el.pendingDialogs = [{
      dialogId: "d2",
      kind: "select",
      title: "Choose how to proceed",
      options: Array.from({ length: 40 }, (_, i) => `Option ${i}: a long label that wraps on a phone`),
    }];
  });
  await page.waitForTimeout(800);

  const selectMetrics = await page.evaluate(() => {
    const el = document.querySelector("chat-view");
    const card = el?.shadowRoot?.querySelector("extension-dialog-card.open-dialog-card");
    if (card === undefined || card === null) return { missing: true };
    const rect = card.getBoundingClientRect();
    const cancel = [...card.shadowRoot.querySelectorAll("button")].find((button) => button.textContent.trim() === "Cancel");
    const innerScrollers = [...card.shadowRoot.querySelectorAll("*")].filter((node) => {
      const style = getComputedStyle(node);
      const scrolls = style.overflowY === "auto" || style.overflowY === "scroll";
      return scrolls && node.scrollHeight > node.clientHeight + 1;
    }).length;
    return {
      winH: window.innerHeight,
      cardBottom: rect.bottom,
      cancelBottom: cancel === undefined ? 0 : cancel.getBoundingClientRect().bottom,
      innerScrollers,
    };
  });
  if (selectMetrics.missing === true) failures.push("select card did not render");
  else {
    if (selectMetrics.cancelBottom > selectMetrics.winH) {
      failures.push(`select card controls below the fold: ${Math.round(selectMetrics.cancelBottom)} > ${selectMetrics.winH}`);
    }
    if (selectMetrics.innerScrollers > 0) {
      failures.push(`select card nests ${selectMetrics.innerScrollers} inner scroll region(s) inside the transcript`);
    }
  }
} catch (error) {
  failures.push(String(error));
} finally {
  await browser.close();
}
if (failures.length > 0) {
  console.error(`dialog scroll check FAILED:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
}
console.log("dialog scroll check passed: long dialogs keep their controls on screen");