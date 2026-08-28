/**
 * A reader aiming at Dismiss has to be able to hit it. Track the button while
 * the transcript streams: if it travels, taps land on whatever moved into its
 * place, which reads as "I clicked many times before it went away".
 *
 * Usage: node scripts/verify-dismiss-stays-put.mjs [port] [project] [workspace] [session]
 */
import { chromium, devices } from "@playwright/test";

const [, , port = "8504", P, W, S] = process.argv;
const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const b = await chromium.launch({ executablePath: exe });
const ctx = await b.newContext({ ...devices["Pixel 5"], colorScheme: "dark" });
const p = await ctx.newPage();
const query = P === undefined ? "" : `?project=${P}&workspace=${W ?? ""}&session=${S ?? ""}`;
await p.goto(`http://127.0.0.1:${port}/${query}`, { waitUntil: "networkidle" });
await p.waitForTimeout(6000);

const find = () => p.evaluate(() => {
  const walk = (root) => {
    for (const el of root.querySelectorAll("button")) {
      if ((el.textContent ?? "").trim().toLowerCase() === "dismiss") {
        const r = el.getBoundingClientRect();
        return { y: Math.round(r.y), x: Math.round(r.x), h: Math.round(r.height) };
      }
    }
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) { const hit = walk(el.shadowRoot); if (hit) return hit; }
    return undefined;
  };
  return walk(document);
});

const first = await find();
if (first === undefined) {
  console.error("FAIL: no Dismiss button on screen, so its stability was not measured");
  process.exit(1);
}

const samples = [first];
for (let i = 0; i < 8; i += 1) {
  await p.waitForTimeout(700);
  const now = await find();
  if (now !== undefined) samples.push(now);
}
console.log(JSON.stringify(samples));

const travel = Math.max(...samples.map((s) => Math.abs(s.y - first.y)));
const TOLERANCE_PX = 8;
if (travel > TOLERANCE_PX) {
  console.error(`FAIL: Dismiss moved ${String(travel)}px while the reader was aiming at it`);
  process.exitCode = 1;
} else console.log(`PASS: Dismiss stayed within ${String(travel)}px`);

await ctx.close(); await b.close();
