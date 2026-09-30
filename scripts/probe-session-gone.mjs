import { chromium } from "@playwright/test";

/**
 * A link that names a session opens that session, or says why it cannot
 * (state-diagram D8, "The target of a session link"; P2 slice b, B31; owner Q8).
 *
 * Before: a link to a session missing from the workspace listing fell through
 * to the latest session, so a deleted session's link opened a different one
 * while the URL still named the deleted id.
 *
 * Phone 393x850, coarse pointer, the 8505 seed workspace:
 * - A: a link to a deleted id. Expect nothing selected, "This session no longer
 *   exists on Local." with the way back, and the URL still naming the id.
 * - B: the way back. Expect the target forgotten and the URL without the id.
 * - C: the locate is held for 4 s. Expect only "Loading this session…" while it
 *   is held, never the gone words, then the gone words.
 * - D: the locate's connection is reset for 5 s. Expect it asked again, the
 *   loading words meanwhile, then the gone words.
 * - E, control: a link to a live session opens that session.
 * - F: on the phone, the navigation key opens navigation over the gone message
 *   as it does over a session, with a close control, and closing it shows the
 *   message again (before: no close control, no way back to the message).
 * - G: Back and Forward keep the screen and the URL in agreement: back to the
 *   link shows the message again, forward to the workspace shows no target.
 * - H: a remote machine (prod-8504, on an older daemon without the locate
 *   route). Expect the route to reach it, and its not-found envelope to read
 *   "This session isn't in <workspace> on prod-8504.", never an endless
 *   loading message.
 */
const BASE = process.env.PI_WEB_PROBE_BASE ?? process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = "ef2cdf93e1ac";
const CWD = "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";
const DELETED = "deadbeef-0000-7000-8000-000000000000";
const LOCATE = /\/api\/machines\/local\/sessions\/[^/]+\/locate\?/u;
const GONE_WORDS = "This session no longer exists on Local.";
const LOADING_WORDS = "Loading this session…";
const REMOTE = { machine: "prod-8504-waveb", project: "93ebd97a-902f-4804-ba35-f9f6fcf2258a", workspace: "0fc561d6efb4" };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
function leg(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` - ${detail}`}`);
}

const link = (sessionId) => `${BASE}/?machine=local&project=${PROJECT}&workspace=${WORKSPACE}&session=${encodeURIComponent(sessionId)}`;

async function surface(page) {
  return page.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    const deep = (root) => [...root.querySelectorAll("*")].flatMap((element) => [
      ...(element.matches(".empty.session-target") && element.checkVisibility() ? [{ text: element.querySelector("p")?.textContent?.trim() ?? "", button: element.querySelector("button")?.textContent?.trim(), role: element.getAttribute("role") }] : []),
      ...(element.shadowRoot ? deep(element.shadowRoot) : []),
    ]);
    const state = app?.state;
    return {
      selected: state?.selectedSession?.id,
      workspace: state?.selectedWorkspace?.id,
      target: state?.sessionTarget?.target?.kind,
      panel: deep(document)[0],
      session: new URL(location.href).searchParams.get("session"),
    };
  });
}

async function watch(page, until, ms = 20_000) {
  const seen = [];
  const started = Date.now();
  let last;
  while (Date.now() - started < ms) {
    last = await surface(page);
    const words = last.panel?.text;
    if (words !== undefined && !seen.includes(words)) seen.push(words);
    if (until(last)) break;
    await sleep(150);
  }
  return { last, seen };
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const listing = await (await context.request.get(`${BASE}/api/machines/local/sessions?cwd=${encodeURIComponent(CWD)}`)).json();
  const live = Array.isArray(listing) ? listing.find((session) => session.archived !== true && session.cwdMissing !== true) : undefined;
  const deletedProbe = await context.request.get(`${BASE}/api/machines/local/sessions/${DELETED}/status?cwd=${encodeURIComponent(CWD)}`);
  leg("precondition: the seed workspace lists a live session, and the deleted id is unknown to the daemon", live !== undefined && deletedProbe.status() === 404, `live ${String(live?.id)}, deleted status ${String(deletedProbe.status())}`);

  const a = await context.newPage();
  await a.goto(link(DELETED), { waitUntil: "domcontentloaded" });
  const aSeen = await watch(a, (s) => s.workspace === WORKSPACE && (s.selected !== undefined || s.panel?.text === GONE_WORDS));
  leg("A: a link to a deleted session opens no other session", aSeen.last.workspace === WORKSPACE && aSeen.last.selected === undefined, `workspace ${String(aSeen.last.workspace)}, selected ${String(aSeen.last.selected)}`);
  leg("A: it says the session no longer exists, with the way back", aSeen.last.panel?.text === GONE_WORDS && aSeen.last.panel.role === "alert" && /^Go to .+'s sessions$/u.test(aSeen.last.panel.button ?? ""), JSON.stringify(aSeen.last.panel));
  leg("A: the URL still names the deleted session", aSeen.last.session === DELETED, `session=${String(aSeen.last.session)}`);
  await a.screenshot({ path: "/tmp/probe-session-gone-a.png" });

  const tapped = aSeen.last.panel?.button !== undefined;
  if (tapped) await a.getByRole("button", { name: aSeen.last.panel.button }).click();
  await sleep(600);
  const b = await surface(a);
  leg("B: the way back forgets the target and the URL stops naming it", tapped && b.target === undefined && b.session === null && b.panel === undefined, `tapped ${String(tapped)}, target ${String(b.target)}, session=${String(b.session)}`);
  await a.close();

  const c = await context.newPage();
  let heldLocates = 0;
  await c.route(LOCATE, async (route) => {
    heldLocates += 1;
    await sleep(4000);
    await route.continue();
  });
  await c.goto(link(DELETED), { waitUntil: "domcontentloaded" });
  const cHeld = await watch(c, () => false, 3500);
  const cDone = await watch(c, (s) => s.panel?.text === GONE_WORDS, 10_000);
  leg("precondition C: the locate was asked and held", heldLocates >= 1, `locates ${String(heldLocates)}`);
  leg("C: while the answer is held it says only that the session is loading", cHeld.seen.length === 1 && cHeld.seen[0] === LOADING_WORDS && cHeld.last.selected === undefined, JSON.stringify(cHeld.seen));
  leg("C: the answer then says it is gone", cDone.last.panel?.text === GONE_WORDS, JSON.stringify(cDone.seen));
  await c.close();

  const d = await context.newPage();
  let resetUntil;
  let resets = 0;
  let passed = 0;
  await d.route(LOCATE, async (route) => {
    resetUntil ??= Date.now() + 5000;
    if (Date.now() < resetUntil) {
      resets += 1;
      return route.abort("connectionreset");
    }
    passed += 1;
    return route.continue();
  });
  await d.goto(link(DELETED), { waitUntil: "domcontentloaded" });
  const dSeen = await watch(d, (s) => s.panel?.text === GONE_WORDS, 25_000);
  leg("precondition D: the locate was reset, asked again, and finally answered", resets >= 2 && passed >= 1, `resets ${String(resets)}, answered ${String(passed)}`);
  leg("D: an unanswered locate is never taken for gone: loading, then gone", dSeen.seen[0] === LOADING_WORDS && dSeen.last.panel?.text === GONE_WORDS && dSeen.last.selected === undefined, JSON.stringify(dSeen.seen));
  await d.close();

  const f = await context.newPage();
  await f.goto(link(DELETED), { waitUntil: "domcontentloaded" });
  await watch(f, (s) => s.panel?.text === GONE_WORDS);
  await f.getByRole("button", { name: "Open navigation" }).first().click();
  await sleep(500);
  const fOpened = await surface(f);
  const closer = f.getByRole("button", { name: "Close navigation" }).first();
  const returnable = await closer.isVisible().catch(() => false);
  if (returnable) await closer.click({ timeout: 5000 });
  await sleep(500);
  const fBack = await surface(f);
  leg("F: the navigation page opened from the gone message is returnable, and closing it shows the message again", returnable && fBack.panel?.text === GONE_WORDS, `opened panel ${JSON.stringify(fOpened.panel)}, returnable ${String(returnable)}, back ${JSON.stringify(fBack.panel)}`);
  await f.close();

  const g = await context.newPage();
  await g.goto(link(DELETED), { waitUntil: "domcontentloaded" });
  const gStart = await watch(g, (s) => s.panel?.text === GONE_WORDS);
  const wayBack = gStart.last.panel?.button;
  const tookWayBack = wayBack !== undefined && await g.getByRole("button", { name: wayBack }).click({ timeout: 5000 }).then(() => true, () => false);
  await sleep(500);
  await g.goBack();
  const gBack = await watch(g, (s) => s.panel?.text === GONE_WORDS, 10_000);
  await g.goForward();
  await sleep(1500);
  const gForward = await surface(g);
  leg("precondition G: the way back was taken from the message", tookWayBack, String(wayBack));
  leg("G: back to the link shows the message again", gBack.last.panel?.text === GONE_WORDS && gBack.last.session === DELETED, JSON.stringify(gBack.last));
  leg("G: forward to the workspace shows no target, and the URL names none", gForward.target === undefined && gForward.panel === undefined && gForward.session === null, JSON.stringify(gForward));
  await g.close();

  const e = await context.newPage();
  await e.goto(link(live?.id ?? "missing-live-session"), { waitUntil: "domcontentloaded" });
  const eSeen = await watch(e, (s) => s.selected !== undefined);
  leg("E, control: a link to a live session opens it", live !== undefined && eSeen.last.selected === live.id && eSeen.last.panel === undefined, `selected ${String(eSeen.last.selected)}`);
  await e.close();
  const remote = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  const h = await remote.newPage();
  let remoteLocates = 0;
  await h.route(/\/api\/machines\/prod-8504-waveb\/sessions\/[^/]+\/locate\?/u, async (route) => { remoteLocates += 1; await route.continue(); });
  await h.goto(`${BASE}/?machine=${REMOTE.machine}&project=${REMOTE.project}&workspace=${REMOTE.workspace}&session=${DELETED}`, { waitUntil: "domcontentloaded" });
  const hSeen = await watch(h, (s) => s.panel?.button !== undefined, 45_000);
  leg("precondition H: the remote locate was asked", remoteLocates >= 1, `locates ${String(remoteLocates)}`);
  leg("H: an older remote daemon's silence reads as not in the workspace, not as endless loading", /^This session isn't in .+ on prod-8504\.$/u.test(hSeen.last.panel?.text ?? "") && hSeen.last.selected === undefined, JSON.stringify(hSeen.seen));
  await h.screenshot({ path: "/tmp/probe-session-gone-h.png" });
  await remote.close();
} finally {
  await browser.close();
}

const passedLegs = results.filter(Boolean).length;
console.log(`${String(passedLegs)}/${String(results.length)} legs passed`);
process.exit(passedLegs === results.length ? 0 : 1);
