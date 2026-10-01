import { chromium } from "@playwright/test";

/**
 * A remote machine's pins are read and written through the gateway (P5 slice b), 8505.
 *
 * The probe registers 8505 as a remote machine of itself, so the gateway's machine proxy forwards
 * `/api/machines/<self>/session-pins` to a real web process and the remote's `/events` socket to
 * a real daemon, without touching another machine's pins. It removes the machine at the end.
 *
 * - Through the gateway, the remote's pins read as JSON and a pin written there lands in that
 *   machine's store (before: the gateway had no such route and answered the app shell).
 * - A page selected on Local, showing the remote's pins (as the quick switcher's machine tab
 *   does), shows a pin made on the remote within 3 s through one read, with no reload.
 *
 * Limits: "local" and the remote share one daemon here, so every write announces on both
 * sockets. The probe shows the activity socket credits the remote (only that refresh reads the
 * remote's URL), but it cannot show one machine's event is never credited to another, nor cover a
 * selected remote whose events come on the main socket; those are unit-tested
 * (`PiWebApp.pinsLive.test.ts`). It unpins SESSION on 8505's own store first, so it is for the
 * 8505 test stack only.
 */
const BASE = "http://127.0.0.1:8505";
const PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = "ef2cdf93e1ac";
const SESSION = "01a05000-5eed-7c00-8000-0000000000e1";
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` (${detail})`}`);
};
const json = async (response) => { try { return await response.json(); } catch { return undefined; } };

const added = await fetch(`${BASE}/api/machines`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "probe-self", baseUrl: `${BASE}/` }) });
const self = await json(added);
const selfId = self?.id;
const pinsUrl = `${BASE}/api/machines/${encodeURIComponent(String(selfId))}/session-pins`;
const setPin = (pinned) => fetch(pinsUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: SESSION, pinned }) });
const browser = await chromium.launch();
try {
  check("precondition: 8505 took itself as a remote machine", added.ok && typeof selfId === "string", `status ${String(added.status)}`);
  await fetch(`${BASE}/api/machines/local/session-pins`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: SESSION, pinned: false }) });

  const read = await fetch(pinsUrl);
  const readBody = await json(read);
  check("the gateway reads a remote machine's pins as JSON", read.status === 200 && Array.isArray(readBody?.pinnedSessionIds), `status ${String(read.status)}, ${read.headers.get("content-type") ?? "no type"}`);
  const wrote = await setPin(true);
  const local = await json(await fetch(`${BASE}/api/machines/local/session-pins`));
  check("a pin written through the gateway lands in that machine's store", wrote.status === 200 && local?.pinnedSessionIds?.includes(SESSION) === true, `status ${String(wrote.status)}`);
  await setPin(false);

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  const remoteReads = [];
  page.on("request", (request) => { if (request.url().includes(`/api/machines/${encodeURIComponent(String(selfId))}/session-pins`)) remoteReads.push(Date.now()); });
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${SESSION}`);
  await page.waitForTimeout(8000);
  const remotePinned = () => page.evaluate(({ machineId, sessionId }) => {
    const app = document.querySelector("pi-web-app");
    const pins = app?.pinnedSessionIdsFor?.(machineId);
    return pins instanceof Set ? pins.has(sessionId) : undefined;
  }, { machineId: selfId, sessionId: SESSION });
  const before = await remotePinned();
  await page.waitForTimeout(3000);
  check("precondition: the page read the remote's pins, and the session is not pinned there", remoteReads.length >= 1 && before === false, `reads ${String(remoteReads.length)}, pinned ${String(before)}`);

  const pinnedFrom = Date.now();
  await setPin(true);
  let shownAfter;
  for (let waited = 0; waited <= 3000; waited += 100) {
    if (await remotePinned()) { shownAfter = Date.now() - pinnedFrom; break; }
    await page.waitForTimeout(100);
  }
  check("a pin made on the remote shows within 3 s without a reload", shownAfter !== undefined, `after ${String(shownAfter)} ms`);
  const readsAfter = remoteReads.filter((at) => at >= pinnedFrom).length;
  check("it took one read of the remote's pins", readsAfter === 1, `reads ${String(readsAfter)}`);
} finally {
  if (typeof selfId === "string") {
    await setPin(false).catch(() => undefined);
    await fetch(`${BASE}/api/machines/${encodeURIComponent(selfId)}`, { method: "DELETE" });
  }
  await browser.close();
}
const failed = results.filter((result) => !result.pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
