import { createServer } from "node:http";
import { chromium } from "@playwright/test";

/**
 * An answer is a message (B26, state-diagram D2): it shows as queued from the moment it is given,
 * and the agent reads it at the next injection point, not after all its remaining work. 8505.
 *
 * The audit's case (product audit 5d672be6, messages P1-2): the model calls `ask_user` beside
 * `bash sleep`, and the reader answers at once. This probe serves the `pi-web-probe/flaky` model
 * that ~/.pi/agent/extensions/ui-custom-probe.ts registers on 8505: its reply to the probe's prompt
 * makes both tool calls, every other reply is plain text. No real model is prompted.
 *
 * - queued: while the bash sleep runs, the status lists the answer and a phone page shows its
 *   answers record marked Queued.
 * - injection point: the first model request after the tool batch already carries the answer.
 *   Through the follow-up queue it came one request later, once the agent had nothing left to do.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const CWD = process.env.PROBE_CWD ?? "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";
const PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = "ef2cdf93e1ac";
const SLEEP_SECONDS = 25;
const ANSWERS_TEXT = "The user submitted answers to your questions.";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const check = (name, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` (${detail})`}`);
};

const requests = [];
const chunk = (delta, finish) => `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "flaky", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
const server = createServer((request, response) => {
  let body = "";
  request.on("data", (part) => { body += part; });
  request.on("end", () => {
    requests.push({ at: Date.now(), answers: body.includes(ANSWERS_TEXT), afterTools: body.includes("\"role\":\"tool\"") });
    response.writeHead(200, { "content-type": "text/event-stream" });
    if (body.includes("probe-answer") && !body.includes("call_ask")) {
      const ask = { questions: [{ id: "db", question: "Which database?", options: [{ value: "pg", label: "Postgres" }, { value: "sqlite", label: "SQLite" }] }] };
      response.write(chunk({ role: "assistant", tool_calls: [
        { index: 0, id: "call_ask", type: "function", function: { name: "ask_user", arguments: JSON.stringify(ask) } },
        { index: 1, id: "call_bash", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: `sleep ${String(SLEEP_SECONDS)}` }) } },
      ] }, null));
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
const browser = await chromium.launch();
let sessionId;
try {
  sessionId = (await api("sessions", {})).id;
  console.log("session:", sessionId);
  const selected = await api(`sessions/${sessionId}/model`, { provider: "pi-web-probe", modelId: "flaky" });
  if (selected?.model?.provider !== "pi-web-probe") throw new Error("the zero-cost fixture model is not selectable; this probe never prompts a real model");
  await api(`sessions/${sessionId}/prompt`, { text: "probe-answer: ask me, and sleep meanwhile" });

  let ask;
  for (let waited = 0; waited < 30_000 && ask === undefined; waited += 250) {
    ask = (await status(sessionId)).pendingAsk;
    if (ask === undefined) await sleep(250);
  }
  check("precondition: the model asked while its bash sleep runs", ask !== undefined);
  if (ask === undefined) throw new Error("no ask opened");
  const answeredAt = Date.now();
  await api(`sessions/${sessionId}/ask/submit`, { askId: ask.askId, answers: [{ id: "db", values: ["pg"] }] });

  const queued = (await status(sessionId)).queuedAnswers ?? [];
  check("queued: the status lists the answer the agent has not read", queued.some((answer) => answer.askId === ask.askId), `${String(queued.length)} listed`);

  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${sessionId}&view=chat`);
  let row = null;
  for (let waited = 0; waited < 8000 && row === null; waited += 250) {
    row = await page.evaluate(() => {
      const find = (root) => {
        for (const node of root.querySelectorAll("article.ask-user-record-shell")) return node;
        for (const node of root.querySelectorAll("*")) {
          if (node.shadowRoot === null) continue;
          const inner = find(node.shadowRoot);
          if (inner !== null) return inner;
        }
        return null;
      };
      const article = find(document);
      return article === null ? null : { queued: article.querySelector(".delivery-mark")?.textContent.includes("Queued") === true };
    });
    if (row === null) await page.waitForTimeout(250);
  }
  const stillSleeping = Date.now() - answeredAt < SLEEP_SECONDS * 1000;
  check("precondition: the page was read while the bash sleep still ran", stillSleeping, `${String(Date.now() - answeredAt)} ms after the answer`);
  check("queued: the phone page shows the answers record marked Queued", row?.queued === true, JSON.stringify(row));
  await page.screenshot({ path: "/tmp/surfaces/answer-queued-phone.png" });
  await context.close();

  for (let waited = 0; waited < 90_000; waited += 500) {
    const state = await status(sessionId);
    if (state.isStreaming === false && requests.length >= 2) break;
    await sleep(500);
  }
  const afterTools = requests.find((entry) => entry.afterTools);
  check("precondition: the model was asked again after the tool batch", afterTools !== undefined, `${String(requests.length)} requests`);
  check("injection point: the first request after the tool batch carries the answer", afterTools?.answers === true, JSON.stringify(requests.map((entry) => ({ answers: entry.answers, afterTools: entry.afterTools }))));
} finally {
  await browser.close();
  server.close();
  if (sessionId !== undefined) await api(`sessions/${sessionId}/archive`, {}).catch(() => undefined);
}
const failed = results.filter((pass) => !pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
