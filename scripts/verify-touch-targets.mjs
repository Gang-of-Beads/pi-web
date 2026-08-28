/**
 * Copy and resend are drawn small on purpose. What a finger has to hit is not
 * the drawing: check the reachable area, not the icon.
 *
 * Usage: node scripts/verify-touch-targets.mjs [port]
 */
import { enterBusiestSession, openApp } from "./lib/liveApp.mjs";

const FINGER_PX = 44;
const port = process.argv[2] ?? "8505";
const app = await openApp({ port, phone: true });

const session = await enterBusiestSession(app.page);
if (session === undefined) {
  console.error("FAIL: no conversation was reached, so no message actions were measured");
  await app.close();
  process.exit(1);
}

const measured = await app.page.evaluate((finger) => {
  const root = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view")?.shadowRoot;
  const actions = [...(root?.querySelectorAll(".msg-action") ?? [])];
  return actions.slice(0, 6).map((el) => {
    const drawn = el.getBoundingClientRect();
    const reach = getComputedStyle(el, "::after").inset;
    const grown = Number.parseFloat(reach);
    const reachable = Number.isNaN(grown) ? drawn.width : drawn.width + Math.abs(grown) * 2;
    return {
      label: (el.getAttribute("aria-label") ?? "").slice(0, 28),
      drawn: Math.round(drawn.width),
      reachable: Math.round(reachable),
      enough: reachable >= finger,
    };
  });
}, FINGER_PX);

if (measured.length === 0) {
  console.error("FAIL: no message actions were on screen, so their reach was never measured");
  await app.close();
  process.exit(1);
}

console.log(JSON.stringify(measured));
const small = measured.filter((action) => !action.enough);
if (small.length > 0) {
  console.error(`FAIL: ${String(small.length)} action(s) reach only ${small.map((a) => a.reachable).join(", ")}px, under ${String(FINGER_PX)}`);
  process.exitCode = 1;
} else console.log(`PASS: every action reaches at least ${String(FINGER_PX)}px`);

await app.close();
