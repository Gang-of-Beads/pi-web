import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

/**
 * A Stop the reader presses leaves a visible settled row, live and after a reload (B30).
 *
 * Owner, 2026-09-30: "现在手动interrupted没有任何提示，status/消息都没，直接就idle了". pi ends a
 * reply the reader stopped with stopReason "aborted", and only the "error" form had a row.
 *
 * Serves the `pi-web-probe/flaky` model (ui-custom-probe fixture on 8505). Two producers:
 * - "probe-long" streams "tick n." every 400 ms for 20 s; the probe taps Stop three seconds in.
 * - "probe-backoff" answers 503 every time; the probe taps Stop while pi waits to retry. pi writes
 *   no reply then, and hides the failed attempt as retried (review 6cc25868 N2).
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const CWD = process.env.PROBE_CWD ?? "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";
const PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = "ef2cdf93e1ac";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
function leg(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` - ${detail}`}`);
}

let longRequests = 0;
let backoffRequests = 0;
const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", async () => {
    const chunk = (delta, finish) => `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "flaky", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    if (body.includes("probe-backoff")) {
      backoffRequests += 1;
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "overloaded", type: "server_error" } }));
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    if (!body.includes("probe-long")) {
      response.write(chunk({ role: "assistant", content: "probe warm reply" }, null));
      response.write(chunk({}, "stop"));
      response.end("data: [DONE]\n\n");
      return;
    }
    longRequests += 1;
    let closed = false;
    request.on("close", () => { closed = true; });
    response.on("close", () => { closed = true; });
    response.write(chunk({ role: "assistant", content: "" }, null));
    for (let tick = 1; tick <= 50 && !closed; tick += 1) {
      response.write(chunk({ content: `tick ${String(tick)}. ` }, null));
      await sleep(400);
    }
    if (closed) return;
    response.write(chunk({}, "stop"));
    response.end("data: [DONE]\n\n");
  });
});
await new Promise((resolve) => server.listen(18999, "127.0.0.1", resolve));

const api = (path, init) => fetch(`${BASE}/api/${path}`, { headers: { "content-type": "application/json" }, ...init }).then((response) => response.json());
const created = await api("sessions", { method: "POST", body: JSON.stringify({ cwd: CWD }) });
const sessionId = created.id;
if (typeof sessionId !== "string") throw new Error(`no session: ${JSON.stringify(created)}`);
console.log("session:", sessionId);
const selected = await api(`sessions/${sessionId}/model`, { method: "POST", body: JSON.stringify({ cwd: CWD, provider: "pi-web-probe", modelId: "flaky" }) });
if (selected?.model?.provider !== "pi-web-probe") throw new Error(`the probe model is not selectable (is the fixture loaded?): ${JSON.stringify(selected).slice(0, 300)}`);
const status = () => api(`sessions/${sessionId}/status?cwd=${encodeURIComponent(CWD)}`);
async function waitIdle(label) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if ((await status()).isStreaming !== true) return;
    await sleep(500);
  }
  throw new Error(`${label} never ended`);
}
await api(`sessions/${sessionId}/prompt`, { method: "POST", body: JSON.stringify({ cwd: CWD, text: "warm up" }) });
await sleep(1500);
await waitIdle("the warm-up turn");

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const rows = () => page.evaluate(() => {
    const deepText = (node) => [...node.childNodes].map((child) => (child.nodeType === Node.TEXT_NODE ? child.textContent : deepText(child))).join("") + (node.shadowRoot === null || node.shadowRoot === undefined ? "" : deepText(node.shadowRoot));
    const view = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view");
    return [...(view?.shadowRoot?.querySelectorAll("article.msg") ?? [])].map((row) => deepText(row).replace(/\s+/gu, " ").trim());
  });
  const stopRows = async () => (await rows()).filter((text) => /You stopped this turn|Interrupted/u.test(text));
  const showsThisSession = async () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const current = await page.evaluate(() => document.querySelector("pi-web-app")?.state?.selectedSession?.id);
      if (current === sessionId && (await rows()).some((text) => text.includes("probe warm reply"))) return true;
      await sleep(500);
    }
    return false;
  };
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${sessionId}&view=chat`, { waitUntil: "domcontentloaded" });
  const onSession = await showsThisSession();
  leg("precondition: the page shows this session and its warm reply", onSession);
  if (!onSession) throw new Error("the page is not on the probe session; every other leg would be vacuous");

  await api(`sessions/${sessionId}/prompt`, { method: "POST", body: JSON.stringify({ cwd: CWD, text: "probe-long: count" }) });
  await sleep(3000);
  const running = (await status()).isStreaming === true;
  leg("precondition: the long reply is streaming", running && longRequests === 1, `streaming ${String(running)}, requests ${String(longRequests)}`);
  const stop = page.locator("[aria-label='Stop current work']").first();
  await stop.scrollIntoViewIfNeeded();
  await stop.tap();
  await sleep(2500);
  await waitIdle("the stopped turn");
  const live = await stopRows();
  leg("live: exactly one row says you stopped this turn", live.length === 1 && /You stopped this turn/u.test(live[0] ?? ""), JSON.stringify(live));
  leg("live: pi did not retry the stopped reply", longRequests === 1, `requests ${String(longRequests)}`);

  await page.reload({ waitUntil: "domcontentloaded" });
  leg("precondition: the reloaded page is on this session", await showsThisSession());
  await sleep(1500);
  const reloaded = await stopRows();
  leg("after a reload: the same single row", reloaded.length === 1 && /You stopped this turn/u.test(reloaded[0] ?? ""), JSON.stringify(reloaded));

  await api(`sessions/${sessionId}/prompt`, { method: "POST", body: JSON.stringify({ cwd: CWD, text: "probe-backoff: fail" }) });
  for (let attempt = 0; attempt < 40 && backoffRequests === 0; attempt += 1) await sleep(100);
  await sleep(600);
  const waiting = (await status()).isStreaming === true;
  leg("precondition: pi is waiting to retry the failed attempt", waiting && backoffRequests === 1, `streaming ${String(waiting)}, requests ${String(backoffRequests)}`);
  await stop.scrollIntoViewIfNeeded();
  await stop.tap();
  await sleep(2500);
  await waitIdle("the turn stopped during the retry wait");
  const backoffLive = await stopRows();
  leg("live: a Stop during the retry wait leaves its one row", backoffLive.length === 2 && backoffLive.every((text) => /You stopped this turn/u.test(text)), JSON.stringify(backoffLive));
  leg("live: pi did not retry after the Stop", backoffRequests === 1, `requests ${String(backoffRequests)}`);
  await page.reload({ waitUntil: "domcontentloaded" });
  leg("precondition: the page is on this session after the second reload", await showsThisSession());
  await sleep(1500);
  const backoffReloaded = await stopRows();
  leg("after a reload: one row per stopped turn", backoffReloaded.length === 2 && backoffReloaded.every((text) => /You stopped this turn/u.test(text)), JSON.stringify(backoffReloaded));
  mkdirSync("/tmp/journeys", { recursive: true });
  await page.screenshot({ path: "/tmp/journeys/stop-row.png" });
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? `ALL ${results.length} LEGS PASS` : `${failed} of ${results.length} LEGS FAILED`);
process.exitCode = failed === 0 ? 0 : 1;
