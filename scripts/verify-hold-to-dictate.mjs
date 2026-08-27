/**
 * Live check that holding the composer starts dictation and a tap does not.
 *
 * Usage: node scripts/verify-hold-to-dictate.mjs [port]
 */
import { chromium, devices } from "@playwright/test";

const port = process.argv[2] ?? "8505";
const P = "b8f74304-f20d-43a3-80a0-ad698f90ddd9";
const W = "7a65a4a07e22";
const S = "01a037f1-3fc4-714b-bc11-0b1f46117ea0";
const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const b = await chromium.launch({
  executablePath: exe,
  // No real microphone here: without a fake one the recorder fails to start and
  // a working gesture looks like a broken one.
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
const ctx = await b.newContext({ ...devices["Pixel 5"], permissions: ["microphone"] });
const p = await ctx.newPage();
await p.goto(`http://127.0.0.1:${port}/?project=${P}&workspace=${W}&session=${S}`, { waitUntil: "networkidle" });
await p.waitForTimeout(3500);

const box = await p.evaluate(() => {
  const field = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("prompt-editor")?.shadowRoot?.querySelector(".markdown-editor");
  if (!field) return undefined;
  const r = field.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
});
if (box === undefined) { console.error("FAIL: no composer rendered, so this proves nothing"); process.exitCode = 1; await b.close(); process.exit(); }

// Dictation only exists when a speech service is configured. Without one there
// is nothing to start, and reporting that as "holding does not work" would be
// a different failure than the truth.
const configured = await p.evaluate(() => {
  const editor = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("prompt-editor")?.shadowRoot;
  return editor?.querySelector(".editor-dictate") !== null && editor?.querySelector(".editor-dictate") !== undefined;
});
if (!configured) {
  console.error("FAIL: no speech service is configured here, so hold-to-dictate cannot be verified on this instance");
  process.exitCode = 1;
  await b.close();
  process.exit();
}

const dictating = async () => await p.evaluate(() => {
  const editor = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("prompt-editor")?.shadowRoot;
  return editor?.querySelector(".editor-dictate.listening") !== null || editor?.querySelector("[aria-pressed='true']") !== null;
});

await p.mouse.move(box.x, box.y);
await p.mouse.down();
await p.waitForTimeout(150);
await p.mouse.up();
await p.waitForTimeout(400);
const afterTap = await dictating();

await p.mouse.move(box.x, box.y);
await p.mouse.down();
await p.waitForTimeout(900);
const afterHold = await dictating();
await p.mouse.up();

console.log(`轻点后录音=${String(afterTap)}  长按后录音=${String(afterHold)}`);
let failed = false;
if (afterTap) { console.error("FAIL: an ordinary tap started dictation"); failed = true; }
if (!afterHold) { console.error("FAIL: holding the composer did not start dictation"); failed = true; }
if (failed) process.exitCode = 1; else console.log("PASS");
await ctx.close(); await b.close();
