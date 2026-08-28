/**
 * The bar above the conversation says where you are. Check that its words are
 * not sitting underneath the round buttons beside them, and that the project
 * is actually named rather than left to an aria label.
 *
 * Usage: node scripts/verify-identity-readable.mjs [port] [--phone]
 */
import { deepClick, openApp } from "./lib/liveApp.mjs";

const port = process.argv[2] ?? "8505";
const phone = process.argv.includes("--phone");
const app = await openApp({ port, phone });

// The bar is at its most crowded on the project screen, where it carries
// machine, project and workspace at once.
await deepClick(app.page, "pi-web");
await app.page.waitForTimeout(2500);

// Its words scroll; what matters is that none of them is stuck under a button.
await app.page.evaluate(() => {
  const items = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("app-context-bar")?.shadowRoot?.querySelector(".context-items");
  if (items) items.scrollLeft = items.scrollWidth;
});
await app.page.waitForTimeout(600);

const bar = await app.page.evaluate(() => {
  const root = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("app-context-bar")?.shadowRoot;
  if (!root) return undefined;

  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
  const words = [];
  const buttons = [];
  for (const el of root.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const isButton = el.tagName === "BUTTON" || el.getAttribute("role") === "button";
    const own = [...el.childNodes].some((node) => node.nodeType === 3 && (node.textContent ?? "").trim().length > 0);
    if (isButton && !own) buttons.push({ el, label: el.getAttribute("aria-label") ?? "", ...rect(el) });
    else if (own) words.push({ el, text: (el.textContent ?? "").trim().slice(0, 24), ...rect(el) });
  }
  // A label inside a button is not covered by that button.
  const covered = words
    .filter((word) => buttons.some((button) => !button.el.contains(word.el) && !word.el.contains(button.el)
      && word.left < button.right && word.right > button.left && word.top < button.bottom && word.bottom > button.top))
    .map((word) => word.text);
  return { words, buttons, covered, text: (root.textContent ?? "").replace(/\s+/gu, " ").trim() };
});

if (bar === undefined || bar.words.length === 0 || bar.buttons.length === 0) {
  console.error("FAIL: the bar had no words or no buttons to compare, so nothing was checked");
  await app.close();
  process.exit(1);
}

const covered = bar.covered;

console.log("words:", bar.words.length, "buttons:", bar.buttons.length, "covered:", covered.length);
console.log("bar reads:", bar.text.slice(0, 90));

let failed = false;
if (covered.length > 0) {
  console.error(`FAIL: ${String(covered.length)} label(s) sit under a button: ${covered.join(" | ").slice(0, 100)}`);
  failed = true;
}
if (!bar.text.toLowerCase().includes("pi-web")) {
  console.error("FAIL: the project is not named anywhere a reader can see it");
  failed = true;
}
if (!failed) console.log("PASS: the bar reads cleanly");
process.exitCode = failed ? 1 : 0;

await app.close();
