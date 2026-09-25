#!/usr/bin/env node
/**
 * Does the failure row say who stopped the turn?
 *
 * Report: "看不出来是interrupted还是什么问题，感觉总是自己报这个错". An abort used
 * to read as the provider's own "Request was aborted" plus an account footer.
 * The stop now names itself.
 */
import { chromium } from "playwright";
const BASE = process.env.PI_WEB_PROBE_BASE ?? "http://127.0.0.1:8505";
const fail = (m) => { console.error(`FAIL ${m}`); process.exitCode = 1; };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 850 }, isMobile: true, hasTouch: true });
try {
  await page.goto(`${BASE}/?project=991606fd-e498-4b93-a1ce-2af09efdb0e7&workspace=ef2cdf93e1ac&session=01a05000-5eed-7c00-8000-0000000000c1&view=chat`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  const out = await page.evaluate(async () => {
    const deep = (node) => { let text = node.textContent ?? ""; if (node.shadowRoot) text += deep(node.shadowRoot); for (const c of node.children ?? []) text += deep(c); return text; };
    const app = document.querySelector("pi-web-app");
    const board = [...app.shadowRoot.querySelectorAll("app-navigate-page")].find((s) => s.getBoundingClientRect().width > 0);
    if (board !== undefined) { board.shadowRoot.querySelector(".row.session")?.click(); await new Promise((r) => setTimeout(r, 4000)); }
    const sessions = Reflect.get(app, "sessions");
    await Reflect.apply(Reflect.get(sessions, "setModel"), sessions, ["anthropic", "claude-haiku-4-5"]);
    await new Promise((r) => setTimeout(r, 1200));
    void Reflect.apply(Reflect.get(sessions, "send"), sessions, ["Count slowly from 1 to 300, one number per line, nothing else."]);
    for (let w = 0; w < 60_000; w += 500) {
      await new Promise((r) => setTimeout(r, 500));
      if (/receiving response|agent running/u.test(app.shadowRoot.querySelector("chat-view")?.shadowRoot?.textContent ?? "")) break;
    }
    await new Promise((r) => setTimeout(r, 2000));
    const failuresBefore = (deep(app.shadowRoot).match(/Model response failed/gu) ?? []).length;
    await Reflect.apply(Reflect.get(sessions, "stopActiveWork"), sessions, []);
    const noted = Reflect.get(Reflect.get(app, "state"), "stopCause");
    for (let w = 0; w < 30_000; w += 500) {
      await new Promise((r) => setTimeout(r, 500));
      const text = deep(app.shadowRoot).replace(/\s+/gu, " ");
      // A NEW row, not whatever old failure was already on screen - the last
      // run passed on a stale row and hid that no turn was running at all.
      const at = text.lastIndexOf("Model response failed");
      const count = (text.match(/Model response failed/gu) ?? []).length;
      if (count > failuresBefore && text.slice(at).includes("you stopped it")) return `ok: ${text.slice(at, at + 120)}`;
    }
    const text = deep(app.shadowRoot).replace(/\s+/gu, " ");
    const at = text.lastIndexOf("Model response failed");
    return `no new row naming the cause: noted=${String(noted)} rows ${String(failuresBefore)}->${String((text.match(/Model response failed/gu) ?? []).length)} ${at === -1 ? "no failure row" : text.slice(at, at + 140)}`;
  });
  console.log(out);
  if (!out.startsWith("ok")) fail(out); else console.log("PASS the stop names itself");
} finally { await browser.close(); }
