import { createServer } from "node:http";
import { chromium } from "@playwright/test";

/**
 * A streaming reply shows while it streams, as one row growing in place (B32, state-diagram D1),
 * 8505, phone 393x850.
 *
 * The product audit (5d672be6, messages P1-1) saw no text until the turn ended: 0 of 6 samples
 * during a long reply showed any. That was with probe fixtures that write a whole reply in one
 * burst, which cannot show streaming at all. This probe's fixture streams 40 chunks 150 ms apart,
 * and the page is sampled every 250 ms while it does: the assistant row must grow through several
 * lengths before the turn ends, and stay one row.
 *
 * With PROBE_REAL_MODEL=provider/model the same prompt goes to that model instead (a real provider:
 * it costs a little, so it runs only when asked), and the reply must likewise grow in place.
 * Otherwise it serves the `pi-web-probe/flaky` model that ~/.pi/agent/extensions/ui-custom-probe.ts
 * registers on 8505. The session is archived afterwards.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const CWD = process.env.PROBE_CWD ?? "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";
const PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = "ef2cdf93e1ac";
const REAL_MODEL = process.env.PROBE_REAL_MODEL ?? "";
const CHUNKS = 40;
const results = [];
const check = (name, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` (${detail})`}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chunk = (delta, finish) => `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "flaky", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
const server = createServer((request, response) => {
  request.on("data", () => undefined);
  request.on("end", async () => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(chunk({ role: "assistant", content: "" }, null));
    for (let index = 1; index <= CHUNKS; index += 1) {
      response.write(chunk({ content: `line ${String(index)} of the streamed reply\n` }, null));
      await sleep(150);
    }
    response.write(chunk({}, "stop"));
    response.end("data: [DONE]\n\n");
  });
});
await new Promise((resolve) => server.listen(18999, "127.0.0.1", resolve));

const api = (path, body) => fetch(`${BASE}/api/${path}`, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd: CWD, ...body }) }).then((response) => response.json());
const status = (sessionId) => api(`sessions/${sessionId}/status?cwd=${encodeURIComponent(CWD)}`);

const assistantRows = (page) => page.evaluate(() => {
  const all = (root, selector) => [...root.querySelectorAll(selector), ...[...root.querySelectorAll("*")].flatMap((node) => (node.shadowRoot === null ? [] : all(node.shadowRoot, selector)))];
  return all(document, "chat-view").flatMap((view) => [...(view.shadowRoot?.querySelectorAll("article.msg.assistant") ?? [])]).map((row) => {
    const text = row.querySelector("formatted-text")?.text;
    return typeof text === "string" ? text.length : 0;
  });
});

const browser = await chromium.launch();
let sessionId;
let dialogCloser;
try {
  sessionId = (await api("sessions", {})).id;
  console.log("session:", sessionId);
  const [provider, ...modelParts] = REAL_MODEL === "" ? ["pi-web-probe", "flaky"] : REAL_MODEL.split("/");
  const modelId = modelParts.join("/");
  const selected = await api(`sessions/${sessionId}/model`, { provider, modelId });
  if (selected?.model?.provider !== provider) throw new Error(`model ${provider}/${modelId} is not selectable`);
  console.log("model:", `${provider}/${modelId}`);
  dialogCloser = setInterval(() => {
    void status(sessionId).then(async (state) => {
      for (const dialog of state.pendingDialogs ?? []) await api(`sessions/${sessionId}/dialogs/cancel`, { dialogId: dialog.dialogId });
    }).catch(() => undefined);
  }, 1000);

  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${sessionId}&view=chat`);
  await page.waitForTimeout(5000);
  const prompt = REAL_MODEL === "" ? "probe-stream: reply at length" : "Write the numbers from 1 to 120, one per line, each followed by its English name. Nothing else.";
  await api(`sessions/${sessionId}/prompt`, { text: prompt });

  const samples = [];
  let sawStreaming = false;
  for (let waited = 0; waited < 90_000; waited += 250) {
    const state = await status(sessionId);
    const rows = await assistantRows(page);
    if (state.isStreaming === true) {
      sawStreaming = true;
      samples.push(rows);
    } else if (sawStreaming) {
      break;
    }
    await sleep(250);
  }
  const finalRows = await assistantRows(page);
  const lengthsWhileStreaming = samples.map((rows) => rows.at(-1) ?? 0);
  const distinct = new Set(lengthsWhileStreaming.filter((length) => length > 0));
  const rowCounts = new Set(samples.filter((rows) => rows.length > 0).map((rows) => rows.length));
  console.log("samples while streaming:", samples.length, "lengths:", JSON.stringify(lengthsWhileStreaming), "final:", JSON.stringify(finalRows));
  check("precondition: the turn streamed and ended", sawStreaming && samples.length >= 4 && finalRows.length >= 1);
  check("the reply's text showed while it streamed, growing through several lengths", distinct.size >= 3, `${String(distinct.size)} distinct lengths in ${String(samples.length)} samples`);
  check("it grew in place as one row", rowCounts.size <= 1 && [...rowCounts].every((count) => count === 1), `row counts ${JSON.stringify([...rowCounts])}`);
  check("the final row is at least as long as the last streamed length", (finalRows.at(-1) ?? 0) >= Math.max(0, ...lengthsWhileStreaming));
  await page.screenshot({ path: `/tmp/surfaces/stream-grows-${REAL_MODEL === "" ? "fixture" : "real"}-phone.png` });
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
