/**
 * Switching sessions must be visible in the URL.
 *
 * The owner reports the opposite: pick another session, switch a few times, refresh
 * - and the browser comes back to the session he left. The app and the address bar
 * had diverged, so the refresh restored a session he did not choose.
 */
import { chromium } from "playwright";
import { PROBE_BASE, openProbedSession } from "./probeSession.mjs";

const fails = [];
const fail = (message) => { fails.push(message); console.log("FAIL", message); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await openProbedSession(page, PROBE_BASE);
await page.waitForTimeout(2500);

// The list sits behind several shadow roots (app, navigation panel, session list),
// so find the rows by walking rather than by guessing the nesting.
const rows = () => page.evaluate(() => {
  const found = [];
  const walk = (root) => {
    for (const node of root.querySelectorAll("*")) {
      if (node.classList?.contains("action-main")) found.push(node);
      if (node.shadowRoot !== null && node.shadowRoot !== undefined) walk(node.shadowRoot);
    }
  };
  walk(document);
  return found.map((row) => row.textContent?.trim().slice(0, 24));
});
const url = () => page.evaluate(() => location.search);
const selected = () => page.evaluate(() => document.querySelector("pi-web-app")?.state?.selectedSession?.id ?? null);

const pick = async (index) => {
  const picked = await page.evaluate(async (wanted) => {
    const app = document.querySelector("pi-web-app");
    const sessions = app?.state?.sessions ?? [];
    const session = sessions[wanted];
    if (session === undefined) return null;
    await app.sessions.selectSession(session);
    return session.id;
  }, index);
  await page.waitForTimeout(1800);
  return picked;
};

const seen = [];
for (const index of [0, 1, 0]) {
  const picked = await pick(index);
  const state = { picked, url: await url(), selected: await selected() };
  seen.push(state);
  const named = state.selected !== null && state.url.includes(state.selected);
  console.log(`picked #${index}:`, JSON.stringify({ tail: state.selected?.slice(-6), namedInUrl: named, sameAsPicked: state.selected === state.picked }));
  if (picked === null) { fail(`no session at index ${index}`); continue; }
  if (state.selected !== picked) fail(`picking #${index} selected ${state.selected} instead`);
  else if (!named) fail(`the URL does not name the selected session after picking #${index}: ${state.url}`);
}

const last = seen[seen.length - 1];
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);
const restored = await selected();
console.log("after a refresh:", JSON.stringify({ restoredTail: restored?.slice(-6), expectedTail: last.selected?.slice(-6), urlHasSelection: restored !== null && (await url()).includes(restored) }));
if (restored !== last.selected) fail(`a refresh restored ${restored} instead of the session in the URL ${last.selected}`);

console.log(fails.length === 0 ? "PASS" : `FAIL ${fails.length}`);
await browser.close();
