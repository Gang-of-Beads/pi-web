import { createServer } from "node:http";
import { chromium } from "@playwright/test";

/**
 * A page that reconnects learns what happened while it was away (B14 review bd7a6a81, state-diagram
 * D3 "Boot read"), 8505, phone 393x850.
 *
 * The page holds an idle for a session. While its machine socket drops frames, that session's shell
 * command fails, so the page misses the failure. The socket then closes and the page reconnects,
 * which re-reads every status. The status brings the failure, stamped later than the idle the page
 * holds: the Go to page must mark the session "Session hit an error". Before, a status taught an
 * activity only to a session the page knew none for, so it kept saying "Session is done".
 *
 * The page's machine socket is proxied with Playwright's routeWebSocket so frames can be dropped and
 * the connection closed on cue. The probe serves the `pi-web-probe/flaky` model that
 * ~/.pi/agent/extensions/ui-custom-probe.ts registers on 8505; no real model is prompted, and the
 * session is archived afterwards.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const CWD = process.env.PROBE_CWD ?? "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";
const PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = "ef2cdf93e1ac";
const HOME_SESSION = "01a05000-5eed-7c00-8000-0000000000e1";
const STAMP = String(Date.now()).slice(-6);
const NAME = `reconnect learns ${STAMP}`;
const results = [];
const check = (name, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` (${detail})`}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chunk = (delta, finish) => `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "flaky", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
const server = createServer((request, response) => {
  request.on("data", () => undefined);
  request.on("end", () => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(chunk({ role: "assistant", content: "probe done" }, null));
    response.write(chunk({}, "stop"));
    response.end("data: [DONE]\n\n");
  });
});
await new Promise((resolve) => server.listen(18999, "127.0.0.1", resolve));

const api = (path, body) => fetch(`${BASE}/api/${path}`, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd: CWD, ...body }) }).then((response) => response.json());
const status = (sessionId) => api(`sessions/${sessionId}/status?cwd=${encodeURIComponent(CWD)}`);

async function waitFor(read, ready, limitMs) {
  for (let waited = 0; waited < limitMs; waited += 250) {
    const value = await read();
    if (ready(value)) return value;
    await sleep(250);
  }
  return undefined;
}

const heldPhase = (page, sessionId) => page.evaluate((id) => document.querySelector("pi-web-app")?.state?.sessionActivities?.[id]?.phase ?? null, sessionId);

const browser = await chromium.launch();
let sessionId;
let dialogCloser;
try {
  sessionId = (await api("sessions", {})).id;
  console.log("session:", sessionId);
  const selected = await api(`sessions/${sessionId}/model`, { provider: "pi-web-probe", modelId: "flaky" });
  if (selected?.model?.provider !== "pi-web-probe") throw new Error("the zero-cost fixture model is not selectable; this probe never prompts a real model");
  await api(`sessions/${sessionId}/commands/run`, { text: `/name ${NAME}` });
  dialogCloser = setInterval(() => {
    void status(sessionId).then(async (state) => {
      for (const dialog of state.pendingDialogs ?? []) await api(`sessions/${sessionId}/dialogs/cancel`, { dialogId: dialog.dialogId });
    }).catch(() => undefined);
  }, 1000);

  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  let dropping = false;
  let pageSide;
  await context.routeWebSocket(/\/api\/machines\/local\/events$/u, (ws) => {
    pageSide = ws;
    const serverSide = ws.connectToServer();
    serverSide.onMessage((message) => { if (!dropping) ws.send(message); });
    ws.onMessage((message) => { serverSide.send(message); });
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${HOME_SESSION}&view=chat`);
  await page.waitForTimeout(5000);

  await api(`sessions/${sessionId}/prompt`, { text: "probe-reconnect: say ok" });
  const idle = await waitFor(() => status(sessionId), (state) => state.isStreaming !== true && state.activity?.phase === "idle", 30_000);
  const held = await waitFor(() => heldPhase(page, sessionId), (phase) => phase === "idle", 10_000);
  check("precondition: the session went idle and the page holds that idle", idle !== undefined && held === "idle", String(held));

  dropping = true;
  await api(`sessions/${sessionId}/shell`, { text: "!exit 5" });
  const failed = await waitFor(() => status(sessionId), (state) => state.activity?.phase === "error", 15_000);
  await page.waitForTimeout(1500);
  const stillHeld = await heldPhase(page, sessionId);
  check("precondition: the session failed while the page's socket dropped frames, so the page still holds the idle", failed !== undefined && stillHeld === "idle", String(stillHeld));

  dropping = false;
  await pageSide?.close();
  const learned = await waitFor(() => heldPhase(page, sessionId), (phase) => phase === "error", 15_000);
  await page.locator("app-context-bar button[aria-label='Open navigation']").tap();
  await page.waitForTimeout(2500);
  const mark = await page.evaluate((name) => {
    const all = (root, selector) => [...root.querySelectorAll(selector), ...[...root.querySelectorAll("*")].flatMap((node) => (node.shadowRoot === null ? [] : all(node.shadowRoot, selector)))];
    const row = all(document, "app-navigate-page").flatMap((surface) => [...(surface.shadowRoot?.querySelectorAll("button.row.session") ?? [])]).find((candidate) => candidate.getClientRects().length > 0 && candidate.textContent.includes(name));
    return row === undefined ? "no row" : (row.querySelector(".session-state")?.getAttribute("aria-label") ?? "no mark");
  }, NAME);
  check("after reconnecting, the page holds the failure", learned === "error", String(learned ?? (await heldPhase(page, sessionId))));
  check("the Go to page marks the session as failed", mark === "Session hit an error", mark);
  await page.screenshot({ path: "/tmp/surfaces/reconnect-learns-phone.png" });
  await context.close();
} finally {
  clearInterval(dialogCloser);
  await browser.close();
  server.close();
  if (sessionId !== undefined) await api(`sessions/${sessionId}/archive`, {}).catch(() => undefined);
}
const failedCount = results.filter((pass) => !pass).length;
console.log(`${String(results.length - failedCount)}/${String(results.length)} passed`);
process.exit(failedCount === 0 ? 0 : 1);
