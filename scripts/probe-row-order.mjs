import { createServer } from "node:http";
import { chromium } from "@playwright/test";

/**
 * Messages and commands stay in the order they were sent (B2, state-diagram D1 "Row placement is a
 * function of state"), 8505, phone 393x850.
 *
 * - A message the daemon listed as queued moved into the pending block below every settled row,
 *   while a later message whose send could not be verified kept its slot above it, so the earlier
 *   message was drawn below the later one.
 * - A command typed after those waiting messages was drawn above them (review 1b6f1553), and once
 *   the turn ended it was drawn above the bash run it was typed during and above the message sent
 *   before it: the bash group carries the time the run ended.
 * - A failed message retried after the turn ended jumped back to its first slot, above the reply
 *   that came before the retry; a reload draws it at the end (review 1b6f1553). Live, a cut send
 *   stays unverifiable through the turn (the ledger has not answered yet), which keeps it at the
 *   tail, so the jump does not form here: these legs guard that a retry still lands after the
 *   reply, live and after a reload. The jump itself is pinned by chatTranscript.test.ts.
 *
 * The probe serves the `pi-web-probe/flaky` model that ~/.pi/agent/extensions/ui-custom-probe.ts
 * registers on 8505: the first prompt runs `bash sleep` so messages wait, every other reply is plain
 * text. The second message's send is cut by the page's own network route. No real model is
 * prompted; the session is archived afterwards.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const CWD = process.env.PROBE_CWD ?? "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";
const PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = "ef2cdf93e1ac";
const STAMP = String(Date.now()).slice(-6);
const FIRST = `first waiting ${STAMP}`;
const SECOND = `second unsent ${STAMP}`;
const COMMAND = "/session";
const REPLY = "probe done";
const PROMPT_ROUTE = /\/sessions\/[^/]+\/prompt(?:\?|$)/u;
const results = [];
const check = (name, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` (${detail})`}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chunk = (delta, finish) => `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "flaky", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
const server = createServer((request, response) => {
  let body = "";
  request.on("data", (part) => { body += part; });
  request.on("end", () => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    if (body.includes("probe-order") && !body.includes("call_order")) {
      response.write(chunk({ role: "assistant", tool_calls: [{ index: 0, id: "call_order", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: "sleep 30" }) } }] }, null));
      response.write(chunk({}, "tool_calls"));
    } else {
      response.write(chunk({ role: "assistant", content: REPLY }, null));
      response.write(chunk({}, "stop"));
    }
    response.end("data: [DONE]\n\n");
  });
});
await new Promise((resolve) => server.listen(18999, "127.0.0.1", resolve));

const api = (path, body) => fetch(`${BASE}/api/${path}`, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd: CWD, ...body }) }).then((response) => response.json());
const status = (sessionId) => api(`sessions/${sessionId}/status?cwd=${encodeURIComponent(CWD)}`);
const working = (state) => state.isStreaming === true || state.isBashRunning === true || (state.pendingMessageCount ?? 0) > 0;

async function waitFor(read, ready, limitMs) {
  for (let waited = 0; waited < limitMs; waited += 250) {
    const value = await read();
    if (ready(value)) return value;
    await sleep(250);
  }
  return undefined;
}

const drawnRows = (page) => page.evaluate(() => {
  const all = (root, selector) => [...root.querySelectorAll(selector), ...[...root.querySelectorAll("*")].flatMap((node) => (node.shadowRoot === null ? [] : all(node.shadowRoot, selector)))];
  return all(document, "chat-view").flatMap((view) => [...(view.shadowRoot?.querySelectorAll("article.msg") ?? [])]).map((row) => {
    const text = row.querySelector("formatted-text")?.text;
    return typeof text === "string" ? text : (row.querySelector(".command-text")?.textContent ?? "").trim();
  }).filter((text) => text !== "");
});
const lastIndexOf = (rows, text) => rows.lastIndexOf(text);

async function send(page, text) {
  await page.locator("prompt-editor .cm-content").first().click({ timeout: 5_000 });
  await page.keyboard.type(text);
  await page.locator("prompt-editor button.send-button").first().click({ timeout: 5_000 });
}

const browser = await chromium.launch();
let sessionId;
let dialogCloser;
try {
  sessionId = (await api("sessions", {})).id;
  console.log("session:", sessionId);
  const selected = await api(`sessions/${sessionId}/model`, { provider: "pi-web-probe", modelId: "flaky" });
  if (selected?.model?.provider !== "pi-web-probe") throw new Error("the zero-cost fixture model is not selectable; this probe never prompts a real model");
  const closeDialogs = async () => {
    for (const dialog of (await status(sessionId)).pendingDialogs ?? []) await api(`sessions/${sessionId}/dialogs/cancel`, { dialogId: dialog.dialogId });
  };
  dialogCloser = setInterval(() => { void closeDialogs().catch(() => undefined); }, 1000);
  await api(`sessions/${sessionId}/prompt`, { text: "probe-order: run a long command" });
  const running = await waitFor(() => status(sessionId), (state) => state.isStreaming === true, 20_000);

  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${sessionId}&view=chat`);
  await page.waitForTimeout(5000);
  check("precondition: the session is running its long command", running !== undefined);

  await send(page, FIRST);
  const listed = await waitFor(() => status(sessionId), (state) => (state.queuedMessages ?? []).some((message) => message.text === FIRST), 8_000);
  check("precondition: the first message waits in the daemon's queue", listed !== undefined);

  await context.route(PROMPT_ROUTE, (route) => route.abort("internetdisconnected"));
  await send(page, SECOND);
  await page.waitForTimeout(2500);
  const ordered = await drawnRows(page);
  console.log("rows while waiting:", JSON.stringify(ordered));
  check("precondition: both messages are on the page", ordered.includes(FIRST) && ordered.includes(SECOND));
  check("the earlier message is drawn above the later one", ordered.indexOf(FIRST) !== -1 && ordered.indexOf(FIRST) < ordered.indexOf(SECOND), `first at ${String(ordered.indexOf(FIRST))}, second at ${String(ordered.indexOf(SECOND))}`);
  await page.screenshot({ path: "/tmp/surfaces/row-order-phone.png" });

  await send(page, COMMAND);
  await page.waitForTimeout(2500);
  const withCommand = await drawnRows(page);
  console.log("rows with the command:", JSON.stringify(withCommand));
  check("precondition: the command row is on the page", withCommand.includes(COMMAND));
  check("a command typed after the waiting messages is drawn below them", lastIndexOf(withCommand, COMMAND) > withCommand.indexOf(SECOND), `command at ${String(lastIndexOf(withCommand, COMMAND))}, second at ${String(withCommand.indexOf(SECOND))}`);

  const failedBeforeReply = await waitFor(() => page.evaluate((text) => {
    const all = (root, selector) => [...root.querySelectorAll(selector), ...[...root.querySelectorAll("*")].flatMap((node) => (node.shadowRoot === null ? [] : all(node.shadowRoot, selector)))];
    const line = (all(document, "chat-view")[0]?.messages ?? []).find((candidate) => candidate.role === "user" && JSON.stringify(candidate.parts).includes(text));
    return line?.meta?.delivery?.state ?? null;
  }, SECOND), (state) => state === "failed", 20_000);
  console.log("the cut message before the turn's reply:", failedBeforeReply ?? "still unverifiable (the ledger had not answered), so the jump this leg guards cannot form live");
  const idle = await waitFor(() => status(sessionId), (state) => !working(state), 60_000);
  await page.waitForTimeout(2000);
  const afterTurn = await drawnRows(page);
  check("precondition: the turn ended and its reply is drawn", idle !== undefined && afterTurn.indexOf(REPLY, afterTurn.indexOf(FIRST)) !== -1, JSON.stringify(afterTurn));
  check("once the turn ended, the command stays below the message sent before it", afterTurn.indexOf(COMMAND) > afterTurn.indexOf(FIRST), `command at ${String(afterTurn.indexOf(COMMAND))}, first at ${String(afterTurn.indexOf(FIRST))}`);
  await context.unroute(PROMPT_ROUTE);
  const secondRow = page.locator("chat-view article.msg.user").filter({ hasText: SECOND }).first();
  await secondRow.locator("button[data-action='retry']").click({ timeout: 5_000 });
  const taken = await waitFor(() => api(`sessions/${sessionId}/messages?cwd=${encodeURIComponent(CWD)}`).catch(() => ({})), (body) => JSON.stringify(body).includes(SECOND), 20_000);
  await waitFor(() => status(sessionId), (state) => !working(state), 20_000);
  await page.waitForTimeout(2500);
  const afterRetry = await drawnRows(page);
  console.log("rows after the retry:", JSON.stringify(afterRetry));
  check("precondition: the retried message was taken", taken !== undefined);
  const replyBefore = (rows) => rows.indexOf(REPLY, rows.indexOf(FIRST));
  check("the retried message is drawn after the reply that came before the retry", afterRetry.indexOf(SECOND) > replyBefore(afterRetry), `second at ${String(afterRetry.indexOf(SECOND))}, that reply at ${String(replyBefore(afterRetry))}`);
  await page.screenshot({ path: "/tmp/surfaces/row-order-retried-phone.png" });
  await page.reload();
  await page.waitForTimeout(6000);
  const reloaded = await drawnRows(page);
  check("a reload draws the retried message after that reply too", reloaded.indexOf(SECOND) > replyBefore(reloaded), JSON.stringify(reloaded));
  await context.close();
} finally {
  clearInterval(dialogCloser);
  await browser.close();
  server.close();
  if (sessionId !== undefined) {
    await api(`sessions/${sessionId}/abort`, {}).catch(() => undefined);
    await api(`sessions/${sessionId}/archive`, {}).catch(() => undefined);
  }
}
const failed = results.filter((pass) => !pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
