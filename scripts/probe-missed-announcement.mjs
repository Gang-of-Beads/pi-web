import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

/**
 * A lost announcement is noticed (state-diagram D5, B28 slice H1), 8505, phone 393x850.
 *
 * The machine's global socket stays open while one frame on it is lost. The probe sits between the
 * daemon and the page (Playwright's routeWebSocket) and drops exactly one `pins.changed` frame, the
 * announcement that a session was pinned elsewhere. Nothing reopens the socket.
 * Legs:
 * - precondition: the page holds the machine's pins, and the session to pin is not among them;
 * - lost last: the dropped frame is followed by nothing, so only the heartbeat's head can reveal it;
 *   the page holds the new pin within one heartbeat (20 s) plus a read, without a reconnect;
 * - lost between: a second dropped `pins.changed` is followed by a frame of another kind (a file
 *   written in the workspace, so `workspace.changed`), whose `seq` skips; the page holds the new pin
 *   within 6 s of that file (the watcher coalesces for 2 s);
 * - control: the global socket was opened once for the whole run.
 * It changes only the pins of two seed sessions and one file of its own, and undoes both at the end. No
 * model is prompted.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = "ef2cdf93e1ac";
const FIRST = "01a05000-5eed-7c00-8000-0000000000d1";
const SECOND = "01a05000-5eed-7c00-8000-0000000000e1";
const WORKSPACE_PATH = process.env.PROBE_CWD ?? "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";
const TOUCHED = join(WORKSPACE_PATH, "probe-missed-announcement.md");
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` (${detail})`}`);
};
const setPinned = (sessionId, pinned) => fetch(`${BASE}/api/machines/local/session-pins`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, pinned }) });

await setPinned(FIRST, false);
await setPinned(SECOND, false);
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  let opens = 0;
  let dropsArmed = 0;
  let dropped = 0;
  const forwarded = [];
  await page.routeWebSocket("**/api/machines/local/events", (socket) => {
    opens += 1;
    const server = socket.connectToServer();
    server.onMessage((message) => {
      const text = typeof message === "string" ? message : message.toString();
      if (dropsArmed > 0 && text.includes("\"pins.changed\"")) {
        dropsArmed -= 1;
        dropped += 1;
        return;
      }
      forwarded.push({ at: Date.now(), type: /"type":"([^"]+)"/u.exec(text)?.[1] ?? "?" });
      socket.send(message);
    });
    socket.onMessage((message) => { server.send(message); });
  });
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}`);
  await page.waitForTimeout(6_000);
  const held = () => page.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    const cache = app?.pinCache;
    return cache?.machineId === "local" ? [...cache.ids] : null;
  });

  const before = await held();
  check("precondition: the page holds the machine's pins, without the sessions to pin", Array.isArray(before) && !before.includes(FIRST) && !before.includes(SECOND) && opens === 1, JSON.stringify({ before, opens }));

  dropsArmed = 1;
  await setPinned(FIRST, true);
  const lostLastStart = Date.now();
  let lostLast;
  for (let waited = 0; waited < 35_000; waited += 500) {
    const now = await held();
    if (now?.includes(FIRST)) { lostLast = Date.now() - lostLastStart; break; }
    await page.waitForTimeout(500);
  }
  const framesBeforeHeal = forwarded.filter((frame) => frame.at >= lostLastStart && frame.at <= lostLastStart + (lostLast ?? 35_000)).map((frame) => frame.type);
  check("lost last: only a heartbeat followed the lost frame, and the page holds the new pin within one heartbeat and a read, without a reconnect", dropped === 1 && framesBeforeHeal.every((type) => type === "keepalive") && lostLast !== undefined && lostLast <= 25_000 && opens === 1, JSON.stringify({ dropped, framesBeforeHeal, healedAfterMs: lostLast ?? "never (35 s)", opens }));

  dropsArmed = 1;
  await setPinned(SECOND, true);
  await page.waitForTimeout(500);
  const beforeTouch = await held();
  await writeFile(TOUCHED, `probe ${String(Date.now())}\n`, "utf8");
  const betweenStart = Date.now();
  let between;
  for (let waited = 0; waited < 12_000; waited += 250) {
    const now = await held();
    if (now?.includes(SECOND)) { between = Date.now() - betweenStart; break; }
    await page.waitForTimeout(250);
  }
  check("lost between: a frame of another kind skips the seq, and the page holds the new pin within 6 s", dropped === 2 && beforeTouch?.includes(SECOND) === false && between !== undefined && between <= 6_000, JSON.stringify({ dropped, beforeTouch, healedAfterMs: between ?? "never (12 s)", held: await held() }));
  check("control: the global socket was opened once for the whole run", opens === 1, String(opens));
  await page.screenshot({ path: "/var/folders/2x/hqbz74zs7fvdxf_53693r26h0000gp/T/.playwright-mcp/h1-missed-announcement-phone.png" });
} finally {
  await browser.close();
  await setPinned(FIRST, false).catch(() => undefined);
  await setPinned(SECOND, false).catch(() => undefined);
  await rm(TOUCHED, { force: true });
}
const failed = results.filter((result) => !result.pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
