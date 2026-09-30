import { createServer } from "node:http";
import { execSync } from "node:child_process";
import { chromium } from "@playwright/test";

/**
 * Messages that waited for a run reach the model in one request (B33, D1 idle injection point).
 *
 * Owner, 2026-09-30: a queued message is held only so it can be taken back; at an injection
 * point every waiting message is handed at once. Before: three messages that waited through a
 * daemon restart became three model requests, each answered on its own.
 *
 * Serves the `pi-web-probe/flaky` model (ui-custom-probe fixture on 8505). A request whose last
 * user message carries "probe-long" streams for 20 s, so the three marked messages sent during it
 * wait in the daemon's inbox; the probe then restarts the 8505 stack and records which marked
 * messages each model request carries.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const CWD = process.env.PROBE_CWD ?? "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";
const PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = "ef2cdf93e1ac";
const MARK = `batch-${String(Date.now())}`;
const SENT = ["B", "C", "D"].map((letter) => `${MARK} message ${letter}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
function leg(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` - ${detail}`}`);
}

const textOf = (content) => (typeof content === "string" ? content : Array.isArray(content) ? content.map((part) => part?.text ?? "").join("") : "");
const markedPerRequest = [];
const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", async () => {
    const chunk = (delta, finish) => `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "flaky", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    const messages = JSON.parse(body).messages ?? [];
    const lastReply = messages.map((message) => message.role).lastIndexOf("assistant");
    const fresh = messages.slice(lastReply + 1).filter((message) => message.role === "user").map((message) => textOf(message.content));
    const last = fresh.at(-1) ?? "";
    response.writeHead(200, { "content-type": "text/event-stream" });
    if (!last.startsWith("Create a 2-6 word title")) {
      const marked = fresh.filter((text) => text.startsWith(MARK));
      if (marked.length > 0) markedPerRequest.push(marked);
    }
    if (!last.includes("probe-long")) {
      response.write(chunk({ role: "assistant", content: marked(last) }, null));
      response.write(chunk({}, "stop"));
      response.end("data: [DONE]\n\n");
      return;
    }
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
function marked(last) {
  return last.startsWith(MARK) ? `answered through ${last.slice(-1)}` : "probe warm reply";
}
await new Promise((resolve) => server.listen(18999, "127.0.0.1", resolve));

const api = (path, init) => fetch(`${BASE}/api/${path}`, { headers: { "content-type": "application/json" }, ...init }).then((response) => response.json());
const created = await api("sessions", { method: "POST", body: JSON.stringify({ cwd: CWD }) });
const sessionId = created.id;
if (typeof sessionId !== "string") throw new Error(`no session: ${JSON.stringify(created)}`);
console.log("session:", sessionId, "mark:", MARK);
const selected = await api(`sessions/${sessionId}/model`, { method: "POST", body: JSON.stringify({ cwd: CWD, provider: "pi-web-probe", modelId: "flaky" }) });
if (selected?.model?.provider !== "pi-web-probe") throw new Error(`the probe model is not selectable (is the fixture loaded?): ${JSON.stringify(selected).slice(0, 300)}`);
const status = () => api(`sessions/${sessionId}/status?cwd=${encodeURIComponent(CWD)}`).catch(() => undefined);
async function waitFor(label, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snapshot = await status();
    if (snapshot !== undefined && predicate(snapshot)) return snapshot;
    if (Date.now() > deadline) throw new Error(`${label}: timed out after ${String(timeoutMs)} ms (last ${JSON.stringify(snapshot)?.slice(0, 200)})`);
    await sleep(500);
  }
}
await api(`sessions/${sessionId}/prompt`, { method: "POST", body: JSON.stringify({ cwd: CWD, text: "warm up" }) });
await sleep(1500);
await waitFor("the warm-up turn", (snapshot) => snapshot.isStreaming !== true, 30_000);

await api(`sessions/${sessionId}/prompt`, { method: "POST", body: JSON.stringify({ cwd: CWD, text: "probe-long: count" }) });
await sleep(2500);
for (const [index, text] of SENT.entries()) {
  await api(`sessions/${sessionId}/prompt`, { method: "POST", body: JSON.stringify({ cwd: CWD, text, clientMessageId: `${MARK}-${String(index)}` }) });
}
const waiting = await status();
const queued = (waiting?.queuedMessages ?? []).map((entry) => entry.text);
leg("precondition: the long reply streams and all three wait", waiting?.isStreaming === true && SENT.every((text) => queued.includes(text)) && markedPerRequest.length === 0, `streaming ${String(waiting?.isStreaming)}, queued ${JSON.stringify(queued)}`);

console.log("restarting the 8505 stack with the three waiting...");
execSync("bash scripts/stack-8505.sh up --skip-build", { stdio: "inherit", cwd: "/Users/hanxiao.du/Desktop/vincent/projects/pi-web" });
const drained = await waitFor("the three are handed after the restart", (snapshot) => snapshot.isStreaming !== true && (snapshot.queuedMessages ?? []).length === 0 && markedPerRequest.flat().length >= SENT.length, 60_000).then(() => true, (error) => { console.log(String(error)); return false; });
leg("precondition: the session reopened and nothing is left waiting", drained);
await sleep(2000);

leg("live: the three waiting messages reach the model in one request, in order", JSON.stringify(markedPerRequest) === JSON.stringify([SENT]), JSON.stringify(markedPerRequest.map((request) => request.map((text) => text.slice(-1)))));

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const rows = () => page.evaluate(() => {
    const deepText = (node) => [...node.childNodes].map((child) => (child.nodeType === Node.TEXT_NODE ? child.textContent : deepText(child))).join("") + (node.shadowRoot === null || node.shadowRoot === undefined ? "" : deepText(node.shadowRoot));
    const view = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view");
    return [...(view?.shadowRoot?.querySelectorAll("article.msg") ?? [])].map((row) => deepText(row).replace(/\s+/gu, " ").trim());
  });
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${sessionId}&view=chat`, { waitUntil: "domcontentloaded" });
  let shown = [];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    shown = await rows();
    if (shown.some((text) => text.includes("answered through"))) break;
    await sleep(500);
  }
  leg("precondition: the page shows this session with its answer", shown.some((text) => text.includes("answered through")), `${String(shown.length)} rows`);
  const positions = SENT.map((text) => shown.findIndex((row) => row.includes(text)));
  const counts = SENT.map((text) => shown.filter((row) => row.includes(text)).length);
  leg("page: each message is one row, in the order sent", counts.every((count) => count === 1) && positions[0] < positions[1] && positions[1] < positions[2], `counts ${JSON.stringify(counts)}, positions ${JSON.stringify(positions)}`);
  const answers = shown.filter((text) => text.includes("answered through")).length;
  leg("page: one answer for the three", answers === 1, `${String(answers)} answer rows`);
  await page.screenshot({ path: "/tmp/journeys/batch-handoff.png" });
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${String(results.length - failed)}/${String(results.length)} legs passed`);
process.exit(failed === 0 ? 0 : 1);
