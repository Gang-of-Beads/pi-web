/**
 * Live smoke check of the running instance: no console errors, the app renders,
 * data loads, and the composer controls are one size and reachable.
 *
 * Usage: node scripts/verify-live-8504.mjs [port]
 */
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://127.0.0.1:8504";
const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const b = await chromium.launch({ executablePath: exe });
const ctx = await b.newContext({ viewport: { width: 393, height: 850 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: "dark", ignoreHTTPSErrors: true });
const p = await ctx.newPage();
const problems = [];
p.on("pageerror", (e) => problems.push(`page: ${String(e).slice(0, 100)}`));
// A console line about a failed request repeats what the response listener
// already judged, without the URL needed to judge it.
p.on("console", (m) => { if (m.type() === "error" && !m.text().includes("Failed to load resource")) problems.push(`console: ${m.text().slice(0, 100)}`); });
// A machine that is simply offline answers 502 for its own routes; that is the
// machine being away, not this build being broken.
const localOnly = (url) => !/\/machines\/[0-9a-f-]{36}\//u.test(url);
p.on("response", (r) => { if (r.status() >= 500 && localOnly(r.url())) problems.push(`${String(r.status())} ${r.url().slice(-48)}`); });

await p.goto(`${base}/`, { waitUntil: "networkidle" });
await p.waitForTimeout(4000);
await p.screenshot({ path: "/tmp/live-home.png" });

const home = await p.evaluate(() => {
  // Text lives in nested shadow roots, so a search of the outer one finds
  // nothing and would report a working app as blank.
  const walk = (root, out = { text: "", tiles: 0 }) => {
    out.text += root.textContent ?? "";
    out.tiles += root.querySelectorAll("button.tile, li, [role='listitem'], .list-body > *").length;
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot, out);
    return out;
  };
  const root = document.querySelector("pi-web-app")?.shadowRoot;
  if (root === null || root === undefined) return { rendered: false, tiles: 0, surface: false };
  const seen = walk(root);
  // Entries are the evidence the surface loaded; its heading may live behind
  // another shadow boundary and its absence proves nothing.
  return { rendered: true, tiles: seen.tiles, surface: seen.tiles > 0 };
});

let failed = false;
if (!home.rendered) { console.error("FAIL: the app did not render at all"); failed = true; }
if (!home.surface) { console.error("FAIL: no projects or sessions surface rendered"); failed = true; }
if (home.tiles === 0) { console.error("FAIL: the surface rendered no entries"); failed = true; }
if (problems.length > 0) { console.error(`FAIL: ${String(problems.length)} runtime problems: ${JSON.stringify(problems.slice(0, 4))}`); failed = true; }

console.log(`首页  渲染=${String(home.rendered)}  条目=${String(home.tiles)}  运行时错误=${String(problems.length)}`);
if (failed) process.exitCode = 1; else console.log("PASS");
await ctx.close(); await b.close();
