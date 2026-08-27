/**
 * Live check that arriving in a chat does not put the caret in the composer on
 * a touch device, which is what raises the on-screen keyboard.
 *
 * Usage: node scripts/verify-no-keyboard-on-switch.mjs
 */
import { chromium, devices } from "@playwright/test";

const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const b = await chromium.launch({ executablePath: exe });

const focusedAfterOpeningASession = async (opts, useShortcut) => {
  const ctx = await b.newContext(opts);
  const p = await ctx.newPage();
  await p.goto("http://127.0.0.1:8505/", { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  const click = (re) => p.evaluate((src) => {
    const rx = new RegExp(src, "i");
    const walk = (root, out = []) => {
      for (const el of root.querySelectorAll("button,[role=option]")) out.push(el);
      for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot, out);
      return out;
    };
    walk(document).find((x) => rx.test(`${x.getAttribute("aria-label") ?? ""} ${(x.textContent ?? "").trim()}`))?.click();
  }, re);
  if (useShortcut) await p.keyboard.press("Meta+p"); else await click("session|switch");
  await p.waitForTimeout(1500);
  await click("messages");
  await p.waitForTimeout(3500);
  const focused = await p.evaluate(() => {
    const deep = (root) => (root.activeElement?.shadowRoot ? deep(root.activeElement.shadowRoot) : root.activeElement);
    const el = deep(document);
    return el === null ? null : `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(" ")[0]}` : ""}`;
  });
  const coarse = await p.evaluate(() => matchMedia("(pointer: coarse)").matches);
  await ctx.close();
  return { focused, coarse };
};

const touch = await focusedAfterOpeningASession({ ...devices["Pixel 5"] }, false);
const desk = await focusedAfterOpeningASession({ viewport: { width: 1440, height: 900 } }, true);
console.log("触屏:", JSON.stringify(touch));
console.log("桌面:", JSON.stringify(desk));

const raisesKeyboard = (what) => what !== null && /textarea|input|cm-content/i.test(what);
if (raisesKeyboard(touch.focused)) {
  console.error(`FAIL: a touch device landed in ${touch.focused}, which raises the keyboard`);
  process.exitCode = 1;
}
if (touch.coarse !== true) {
  console.error("FAIL: the touch context did not report a coarse pointer, so this proves nothing");
  process.exitCode = 1;
}
await b.close();
