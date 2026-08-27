/**
 * Live check that a non-chat view offers a way back to the conversation.
 *
 * Usage: node scripts/verify-way-back-to-chat.mjs [port]
 */
import { chromium, devices } from "@playwright/test";

const port = process.argv[2] ?? "8505";
const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const b = await chromium.launch({ executablePath: exe });
const ctx = await b.newContext({ ...devices["Pixel 5"] });
const p = await ctx.newPage();
const P = "b8f74304-f20d-43a3-80a0-ad698f90ddd9";
const W = "7a65a4a07e22";
const S = "01a037f1-3fc4-714b-bc11-0b1f46117ea0";
await p.goto(`http://127.0.0.1:${port}/?project=${P}&workspace=${W}&session=${S}`, { waitUntil: "networkidle" });
await p.waitForTimeout(3000);

const openedTool = await p.evaluate(() => {
  const app = document.querySelector("pi-web-app");
  const bar = app?.shadowRoot?.querySelector("app-context-bar");
  const button = bar?.shadowRoot?.querySelector('button[title="Go to a view"]');
  if (!button) return false;
  button.click();
  return true;
});
if (!openedTool) { console.error("FAIL: could not open the tool sheet, so this check proves nothing"); process.exitCode = 1; }
await p.waitForTimeout(500);

const chose = await p.evaluate(() => {
  const sheet = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("app-mobile-tool-sheet");
  const target = [...(sheet?.shadowRoot?.querySelectorAll("button") ?? [])].find((el) => (el.textContent ?? "").includes("Files"));
  if (!target) return false;
  target.click();
  return true;
});
if (!chose) { console.error("FAIL: the sheet offered no Files entry, so this check proves nothing"); process.exitCode = 1; }
await p.waitForTimeout(1500);

const found = await p.evaluate(() => {
  const view = new URLSearchParams(location.search).get("view") ?? "";
  const labels = [];
  const walk = (root) => {
    for (const el of root.querySelectorAll("button, a")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Whole words only: "background task" is not a way back to the chat.
      const named = `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""}`.toLowerCase();
      if (/\b(back|chat|conversation)\b/u.test(named)) labels.push(named.trim().slice(0, 40));
    }
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot);
  };
  walk(document);
  return { view, labels };
});

console.log(`view=${found.view}  回对话的控件=${found.labels.length === 0 ? "无" : JSON.stringify(found.labels)}`);
if (found.view === "" || found.view === "chat") {
  console.error("FAIL: never left the conversation, so the check proves nothing");
  process.exitCode = 1;
} else if (found.labels.length === 0) {
  console.error("FAIL: a non-chat view offers no visible way back to the conversation");
  process.exitCode = 1;
} else {
  // Saying it is not doing it: press the control and see where it lands.
  const pressed = await p.evaluate(() => {
    const bar = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("app-context-bar");
    const chip = [...(bar?.shadowRoot?.querySelectorAll("button") ?? [])].find((el) => (el.getAttribute("aria-label") ?? "").includes("Back to the conversation"));
    if (!chip) return false;
    chip.click();
    return true;
  });
  if (!pressed) { console.error("FAIL: the control that claims to go back could not be pressed"); process.exitCode = 1; }
  await p.waitForTimeout(1200);
  const landed = await p.evaluate(() => new URLSearchParams(location.search).get("view") ?? "chat");
  if (landed !== "chat") { console.error(`FAIL: pressing it landed on ${landed}, not the conversation`); process.exitCode = 1; }
  else console.log("PASS: 回到了对话");
}
await ctx.close(); await b.close();
