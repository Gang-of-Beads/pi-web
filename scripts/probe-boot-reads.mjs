import { chromium } from "@playwright/test";

/**
 * A boot reads each socket-kept fact once (state-diagram D5; P6 slice a), 8505, phone 393x850.
 *
 * A boot read the machine's unread set and its pins twice, 3 ms apart: once on the roster or the
 * first render, and once when the realtime socket opened. It read the project's workspace
 * deletion runs twice too: on the workspace change and again at the end of the route restore.
 * Legs:
 * - a deep link to a session boots with one read each of the local unread set, the local pins
 *   and the deletion runs;
 * - with the realtime socket held shut (its URL rewritten to a closed port, so it never opens; a
 *   routeWebSocket mock would open it), the unread set and the pins are still read, about 1.5 s
 *   after boot, and only once;
 * - with a second machine on the roster (8505 registered as its own remote, removed at the end,
 *   as in probe-pins-remote.mjs), that machine's unread set is read once too: the roster used to
 *   read it before its activity socket existed, and the socket's open read it again (review
 *   44fc106b).
 * Controls: the socket opened in the first leg, the unread set and the pins answered (the page
 * holds an unread projection and adopted pins), and the deletion runs answered 200.
 */
const BASE = "http://127.0.0.1:8505";
const DEEP_LINK = `${BASE}/?project=991606fd-e498-4b93-a1ce-2af09efdb0e7&workspace=ef2cdf93e1ac&session=01a05000-5eed-7c00-8000-0000000000e1`;
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` (${detail})`}`);
};

async function boot(browser, { holdSocketShut, remoteId }) {
  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  if (holdSocketShut) {
    await page.addInitScript(() => {
      const Native = window.WebSocket;
      window.WebSocket = class extends Native {
        constructor(url, protocols) {
          super(String(url).endsWith("/api/machines/local/events") ? "ws://127.0.0.1:9/" : url, protocols);
        }
      };
    });
  }
  const started = Date.now();
  const reads = [];
  const remoteReads = [];
  const answers = [];
  let socketOpenedAt;
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/machines/local/sessions/unread") || path.endsWith("/machines/local/session-pins") || path.endsWith("/machines/local/terminal-command-runs")) reads.push({ path, at: Date.now() - started });
    if (remoteId !== undefined && path.endsWith(`/machines/${encodeURIComponent(remoteId)}/sessions/unread`)) remoteReads.push(Date.now() - started);
  });
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (path.endsWith("/machines/local/terminal-command-runs")) answers.push(response.status());
  });
  page.on("websocket", (socket) => {
    if (!socket.url().endsWith("/api/machines/local/events")) return;
    socket.on("framereceived", () => { socketOpenedAt ??= Date.now() - started; });
  });
  await page.goto(DEEP_LINK);
  await page.waitForTimeout(8_000);
  const held = await page.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    return { unreadKnown: app?.sessionUnread?.projection("local") !== undefined, pinsAdopted: app?.pinsAdopted?.has("local") === true, socketPhase: app?.realtime?.phaseFor?.("local")?.kind ?? "unknown" };
  });
  await context.close();
  const count = (suffix) => reads.filter((read) => read.path.endsWith(suffix)).length;
  const firstAt = (suffix) => reads.find((read) => read.path.endsWith(suffix))?.at;
  return { unread: count("/sessions/unread"), pins: count("/session-pins"), runs: count("/terminal-command-runs"), unreadAt: firstAt("/sessions/unread"), pinsAt: firstAt("/session-pins"), answers, socketOpenedAt, held, remoteReads };
}

const browser = await chromium.launch();
try {
  const open = await boot(browser, { holdSocketShut: false });
  check("control: the realtime socket opened", open.socketOpenedAt !== undefined, `first frame at ${String(open.socketOpenedAt)} ms`);
  check("control: the unread set and the pins answered", open.held.unreadKnown && open.held.pinsAdopted, JSON.stringify(open.held));
  check("control: the deletion runs answered", open.answers.length > 0 && open.answers.every((status) => status === 200), JSON.stringify(open.answers));
  check("a boot reads the unread set once", open.unread === 1, `${String(open.unread)} reads`);
  check("a boot reads the pins once", open.pins === 1, `${String(open.pins)} reads`);
  check("a boot reads the deletion runs once", open.runs === 1, `${String(open.runs)} reads`);

  const shut = await boot(browser, { holdSocketShut: true });
  check("control: the realtime socket stayed shut", shut.socketOpenedAt === undefined && shut.held.socketPhase !== "open", `first frame ${String(shut.socketOpenedAt)}, phase ${shut.held.socketPhase}`);
  check("with the socket shut, the unread set and the pins are still read", shut.held.unreadKnown && shut.held.pinsAdopted, JSON.stringify({ unreadKnown: shut.held.unreadKnown, pinsAdopted: shut.held.pinsAdopted }));
  check("with the socket shut, each is read once, after the grace", shut.unread === 1 && shut.pins === 1 && (shut.unreadAt ?? 0) >= 1_400 && (shut.pinsAt ?? 0) >= 1_400, `unread ${String(shut.unread)} at ${String(shut.unreadAt)} ms, pins ${String(shut.pins)} at ${String(shut.pinsAt)} ms`);

  const added = await fetch(`${BASE}/api/machines`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "probe-boot-self", baseUrl: `${BASE}/` }) });
  const addedBody = added.ok ? await added.json() : undefined;
  const selfId = addedBody?.machine?.id ?? addedBody?.id;
  check("precondition: 8505 is on its own roster as a second machine", typeof selfId === "string", `${String(added.status)} ${String(selfId)}`);
  if (typeof selfId === "string") {
    try {
      const withRemote = await boot(browser, { holdSocketShut: false, remoteId: selfId });
      check("a boot reads a second machine's unread set once", withRemote.remoteReads.length === 1, `${String(withRemote.remoteReads.length)} reads at ${withRemote.remoteReads.join(", ")} ms`);
    } finally {
      await fetch(`${BASE}/api/machines/${encodeURIComponent(selfId)}`, { method: "DELETE" });
    }
  }
} finally {
  await browser.close();
}
const failed = results.filter((result) => !result.pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
