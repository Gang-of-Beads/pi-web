import { createServer } from "node:http";

/**
 * Messages sent while a reply streams reach the model's next request together (B33 commit 2, D1).
 *
 * Owner, 2026-09-30: a queued message is held only so it can be taken back; at an injection point
 * everything waiting reaches the model at once. Before: B, C and D sent during A's reply were held
 * until a gap and handed one at a time, and straddled pi's last look at its lane (a real-SDK test
 * measured A; then B and C; then D alone).
 *
 * Serves the `pi-web-probe/flaky` model (ui-custom-probe fixture on 8505). A request whose last user
 * message carries "probe-long" streams for 20 s; the three marked messages are sent during it, and
 * the probe records which marked messages each model request carries. The fixture provider adds
 * 18-25 s before each request, so the run is given 150 s to settle.
 * Legs:
 * - precondition: the long reply streams while the three are sent, and all three are listed;
 * - the three reach the model in one request, in the order sent;
 * - the reply to them is one answer, and nothing is left queued.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const CWD = process.env.PROBE_CWD ?? "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";
const MARK = `running-${String(Date.now())}`;
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
      response.write(chunk({ role: "assistant", content: last.startsWith(MARK) ? `answered through ${last.slice(-1)}` : "probe warm reply" }, null));
      response.write(chunk({}, "stop"));
      response.end("data: [DONE]\n\n");
      return;
    }
    let closed = false;
    response.on("close", () => { closed = true; });
    response.write(chunk({ role: "assistant", content: "" }, null));
    for (let tick = 1; tick <= 25 && !closed; tick += 1) {
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
let sessionId;
try {
  const created = await api("sessions", { method: "POST", body: JSON.stringify({ cwd: CWD }) });
  sessionId = created.id;
  if (typeof sessionId !== "string") throw new Error(`no session: ${JSON.stringify(created)}`);
  const selected = await api(`sessions/${sessionId}/model`, { method: "POST", body: JSON.stringify({ cwd: CWD, provider: "pi-web-probe", modelId: "flaky" }) });
  if (selected?.model?.provider !== "pi-web-probe") throw new Error(`the probe model is not selectable (is the fixture loaded?): ${JSON.stringify(selected).slice(0, 300)}`);
  const status = () => api(`sessions/${sessionId}/status?cwd=${encodeURIComponent(CWD)}`).catch(() => undefined);
  const waitFor = async (predicate, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const snapshot = await status();
      if (snapshot !== undefined && predicate(snapshot)) return snapshot;
      if (Date.now() > deadline) return undefined;
      await sleep(500);
    }
  };
  await api(`sessions/${sessionId}/prompt`, { method: "POST", body: JSON.stringify({ cwd: CWD, text: "warm up" }) });
  await sleep(1500);
  await waitFor((snapshot) => snapshot.isStreaming !== true, 30_000);

  await api(`sessions/${sessionId}/prompt`, { method: "POST", body: JSON.stringify({ cwd: CWD, text: "probe-long: count" }) });
  await sleep(2500);
  for (const [index, text] of SENT.entries()) {
    await api(`sessions/${sessionId}/prompt`, { method: "POST", body: JSON.stringify({ cwd: CWD, text, clientMessageId: `${MARK}-${String(index)}` }) });
    await sleep(300);
  }
  const during = await status();
  const queued = (during?.queuedMessages ?? []).map((entry) => entry.text);
  leg("precondition: the long reply streams while the three are sent, and all three are listed", during?.isStreaming === true && SENT.every((text) => queued.includes(text)) && markedPerRequest.length === 0, `streaming ${String(during?.isStreaming)}, queued ${JSON.stringify(queued.map((text) => text.slice(-1)))}`);

  const settled = await waitFor((snapshot) => snapshot.isStreaming !== true && (snapshot.queuedMessages ?? []).length === 0 && markedPerRequest.flat().length >= SENT.length, 150_000);
  await sleep(2000);
  leg("the three reach the model in one request, in the order sent", JSON.stringify(markedPerRequest) === JSON.stringify([SENT]), JSON.stringify(markedPerRequest.map((request) => request.map((text) => text.slice(-1)))));
  leg("nothing is left queued once the session settles", settled !== undefined, settled === undefined ? "timed out" : "");
} finally {
  if (sessionId !== undefined) await api(`sessions/${sessionId}/archive`, { method: "POST", body: JSON.stringify({ cwd: CWD }) }).catch(() => undefined);
  server.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${String(results.length - failed)}/${String(results.length)} legs passed`);
process.exit(failed === 0 ? 0 : 1);
