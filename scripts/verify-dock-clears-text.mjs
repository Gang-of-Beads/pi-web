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
  const chat = root?.querySelector(".chat");
  if (!dock || !chat) return undefined;

  const d = dock.getBoundingClientRect();
  const c = chat.getBoundingClientRect();
  if (d.height === 0 || c.height === 0) return undefined;

  return {
    dock: { y: Math.round(d.y), h: Math.round(d.height) },
    reading: { y: Math.round(c.y), h: Math.round(c.height) },
    intrudes: Math.round(Math.min(d.bottom, c.bottom) - Math.max(d.top, c.top)),
  };
});

if (seen === undefined) {
  console.error("FAIL: the marker or the reading area was not on screen, so nothing was measured");
  await app.close();
  process.exit(1);
}

console.log("reading area:", JSON.stringify(seen.reading), "marker:", JSON.stringify(seen.dock));
if (seen.intrudes > 0) {
  console.error(`FAIL: the marker sits ${String(seen.intrudes)}px inside the reading area, so text passes under it`);
  process.exitCode = 1;
} else console.log("PASS: the marker sits below the reading area");

await app.close();
