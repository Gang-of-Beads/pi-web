/**
 * The activity marker floats over the conversation. Check that it does not
 * land on top of the words: a translucent strip across a line of tool output
 * makes both the marker and the sentence unreadable.
 *
 * Usage: node scripts/verify-dock-clears-text.mjs [port] [--phone]
 */
import { enterBusiestSession, openApp } from "./lib/liveApp.mjs";

const port = process.argv[2] ?? "8504";
const phone = process.argv.includes("--phone");
const app = await openApp({ port, phone });

const session = await enterBusiestSession(app.page);
if (session === undefined) {
  console.error("FAIL: no conversation was reached, so the marker was never measured against text");
  await app.close();
  process.exit(1);
}
console.log("session:", session.split("\n")[0]);

// The marker is anchored to the bottom of the viewport, so text passes
// beneath it at every scroll position except the very bottom - which is where
// a reader spends most of their time when reading back.
await app.page.evaluate(() => {
  const chat = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view")?.shadowRoot?.querySelector(".chat");
  if (chat) chat.scrollTop = Math.max(0, chat.scrollHeight * 0.6);
});
await app.page.waitForTimeout(1200);

const seen = await app.page.evaluate(() => {
  const root = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view")?.shadowRoot;
  const dock = root?.querySelector(".activity-dock");
  if (!dock) return { dock: undefined };
  const d = dock.getBoundingClientRect();
  if (d.height === 0) return { dock: undefined };

  const overlapped = [];
  let considered = 0;
  for (const el of root?.querySelectorAll(".chat *") ?? []) {
    if (el.closest(".activity-dock") !== null) continue;
    const ownText = [...el.childNodes].some((node) => node.nodeType === 3 && (node.textContent ?? "").trim().length > 0);
    if (!ownText) continue;
    const r = el.getBoundingClientRect();
    if (r.height === 0) continue;
    considered += 1;
    const overlaps = r.left < d.right && r.right > d.left && r.top < d.bottom && r.bottom > d.top;
    if (overlaps) overlapped.push({ text: (el.textContent ?? "").trim().slice(0, 32), y: Math.round(r.y), h: Math.round(r.height) });
  }
  return { dock: { y: Math.round(d.y), h: Math.round(d.height), x: Math.round(d.x), w: Math.round(d.width) }, overlapped, considered };
});

if (seen.dock === undefined) {
  console.error("FAIL: the activity marker was not on screen, so nothing was measured");
  await app.close();
  process.exit(1);
}

console.log("dock:", JSON.stringify(seen.dock), "text lines measured:", seen.considered, "overlapped:", seen.overlapped.length);
if (seen.considered === 0) {
  console.error("FAIL: no text was measured, so clearing it was never demonstrated");
  await app.close();
  process.exit(1);
}
if (seen.overlapped.length > 0) {
  console.error(`FAIL: the marker covers ${String(seen.overlapped.length)} line(s): ${seen.overlapped.map((o) => o.text).join(" | ").slice(0, 120)}`);
  process.exitCode = 1;
} else console.log("PASS: the marker clears the text");

await app.close();
