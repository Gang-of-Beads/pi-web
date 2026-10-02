import { createServer } from "node:http";
import { chromium } from "@playwright/test";

/**
 * Messages stay in the order they were sent while they wait (B2, state-diagram D1 "Row placement is
 * a function of state"), 8505, phone 393x850.
 *
 * A message the daemon listed as queued moved into the pending block below every settled row, while
 * a later message whose send could not be verified kept its slot above it, so the earlier message
 * was drawn below the later one. This probe serves the `pi-web-probe/flaky` model that
 * ~/.pi/agent/extensions/ui-custom-probe.ts registers on 8505: the probe's prompt runs `bash sleep`
 * so messages wait. The second message's send is cut by the page's own network route. No real model
 * is prompted; the session is archived afterwards.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const CWD = process.env.PROBE_CWD ?? "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";
const PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = "ef2cdf93e1ac";
const STAMP = String(Date.now()).slice(-6);
const FIRST = `first waiting ${STAMP}`;
const SECOND = `second unsent ${STAMP}`;
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
      response.write(chunk({ role: "assistant", tool_calls: [{ index: 0, id: "call_order", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: "sleep 40" }) } }] }, null));
      response.write(chunk({}, "tool_calls"));
    } else {
      response.write(chunk({ role: "assistant", content: "probe done" }, null));
      response.write(chunk({}, "stop"));
    }
    response.end("data: [DONE]\n\n");
  });
});
await new Promise((resolve) => server.listen(18999, "127.0.0.1", resolve));

const api = (path, body) => fetch(`${BASE}/api/${path}`, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd: CWD, ...body }) }).then((response) => response.json());
const status = (sessionId) => api(`sessions/${sessionId}/status?cwd=${encodeURIComponent(CWD)}`);

const userRows = (page) => page.evaluate(() => {
  const all = (root, selector) => [...root.querySelectorAll(selector), ...[...root.querySelectorAll("*")].flatMap((node) => (node.shadowRoot === null ? [] : all(node.shadowRoot, selector)))];
  return all(document, "chat-view").flatMap((view) => [...(view.shadowRoot?.querySelectorAll("article.msg.user") ?? [])]).map((row) => {
    const text = row.querySelector("formatted-text");
    return typeof text?.text === "string" ? text.text : "";
  });
});

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
  let running = false;
  for (let waited = 0; waited < 20_000 && !running; waited += 250) {
    running = (await status(sessionId)).isBashRunning === true || (await status(sessionId)).isStreaming === true;
    if (!running) await sleep(250);
  }

  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${sessionId}&view=chat`);
  await page.waitForTimeout(6000);
  check("precondition: the session is running", running);

  await send(page, FIRST);
  let listed = false;
  for (let waited = 0; waited < 10_000 && !listed; waited += 250) {
    listed = ((await status(sessionId)).queuedMessages ?? []).some((message) => message.text === FIRST);
    if (!listed) await sleep(250);
  }
  check("precondition: the first message waits in the daemon's queue", listed);

  await context.route(/\/sessions\/[^/]+\/prompt(?:\?|$)/u, (route) => route.abort("internetdisconnected"));
  await send(page, SECOND);
  await page.waitForTimeout(3000);
  const rows = await userRows(page);
  const first = rows.indexOf(FIRST);
  const second = rows.indexOf(SECOND);
  console.log("user rows:", JSON.stringify(rows));
  console.log("page facts:", JSON.stringify(await page.evaluate(() => {
    const all = (root, selector) => [...root.querySelectorAll(selector), ...[...root.querySelectorAll("*")].flatMap((node) => (node.shadowRoot === null ? [] : all(node.shadowRoot, selector)))];
    const view = all(document, "chat-view")[0];
    return { queued: (view?.status?.queuedMessages ?? []).map((message) => message.text), rows: [...(view?.shadowRoot?.querySelectorAll("article.msg.user") ?? [])].map((row) => `${row.className} | ${row.querySelector(".delivery-mark")?.textContent?.trim() ?? ""}`), lines: (view?.messages ?? []).filter((line) => line.role === "user").map((line) => `${line.meta?.delivery?.state ?? "-"}`) };
  })));
  check("precondition: both messages are on the page", first !== -1 && second !== -1);
  check("the earlier message is drawn above the later one", first !== -1 && second !== -1 && first < second, `first at ${String(first)}, second at ${String(second)}`);
  await page.screenshot({ path: "/tmp/surfaces/row-order-phone.png" });
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
