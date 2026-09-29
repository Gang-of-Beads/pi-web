import { createServer } from "node:http";
import { chromium } from "@playwright/test";

/**
 * A failure pi retried leaves no row, and a cut reply says it was interrupted.
 *
 * The owner saw one turn fail twice (two retried attempts) and could not tell a Stop
 * he pressed from a connection something else cut. This probe serves the
 * `pi-web-probe/flaky` model that ~/.pi/agent/extensions/ui-custom-probe.ts registers
 * on 8505 (PI_WEB_UI_CUSTOM_PROBE=1), and drives both cases through the real daemon,
 * with the page open while the turn runs (the live path) and after a reload (history):
 *
 * - "probe-recover": 503 overloaded twice, then a reply. No failure row may remain.
 * - "probe-cut": 500 "This operation was aborted" every time. pi retries three times
 *   and gives up; exactly one row, "Interrupted before it finished: ...".
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

const attempts = new Map();
const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    const text = body.includes("probe-cut") ? "probe-cut" : body.includes("probe-recover") ? "probe-recover" : "other";
    const attempt = (attempts.get(text) ?? 0) + 1;
    attempts.set(text, attempt);
    const fail = (status, message) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message, type: "server_error" } }));
    };
    if (text === "probe-cut") return fail(500, "This operation was aborted");
    if (text === "probe-recover" && attempt <= 2) return fail(503, "overloaded");
    response.writeHead(200, { "content-type": "text/event-stream" });
    const chunk = (delta, finish) => `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "flaky", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    response.write(chunk({ role: "assistant", content: text === "probe-recover" ? "probe recovered" : "probe warm reply" }, null));
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
async function runTurn(text) {
  await api(`sessions/${sessionId}/prompt`, { method: "POST", body: JSON.stringify({ cwd: CWD, text }) });
  await sleep(1500);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if ((await status()).isStreaming !== true) return;
    await sleep(1000);
  }
  throw new Error(`the turn "${text}" never ended`);
}

await runTurn("warm up");

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 393, height: 850 } });
  const url = `${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${sessionId}&view=chat`;
  const rows = () => page.evaluate(() => {
    const deepText = (node) => [...node.childNodes].map((child) => (child.nodeType === Node.TEXT_NODE ? child.textContent : deepText(child))).join("") + (node.shadowRoot === null || node.shadowRoot === undefined ? "" : deepText(node.shadowRoot));
    const view = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view") ?? (() => { const walk = (root) => { for (const child of root.querySelectorAll("*")) { if (child.localName === "chat-view") return child; if (child.shadowRoot) { const hit = walk(child.shadowRoot); if (hit) return hit; } } return undefined; }; return walk(document); })();
    return [...(view?.shadowRoot?.querySelectorAll("article.msg") ?? [])].map((row) => deepText(row));
  });
  const failureRows = async () => (await rows()).map((text) => text.replace(/\s+/gu, " ").trim()).filter((text) => /Model response failed|Interrupted|You stopped/u.test(text));
  const showsThisSession = async () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const selected = await page.evaluate(() => document.querySelector("pi-web-app")?.state?.selectedSession?.id);
      if (selected === sessionId && (await rows()).some((text) => text.includes("probe warm reply"))) return true;
      await sleep(500);
    }
    return false;
  };
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const onSession = await showsThisSession();
  leg("precondition: the page shows this session and its first reply", onSession);
  if (!onSession) throw new Error("the page is not on the probe session; every other leg would be vacuous");

  await runTurn("probe-recover: say anything");
  await sleep(1500);
  leg("the provider failed twice before answering", attempts.get("probe-recover") === 3, `requests ${String(attempts.get("probe-recover"))}`);
  const liveRecovered = await failureRows();
  leg("live: no row for the two retried failures", liveRecovered.length === 0, JSON.stringify(liveRecovered));
  leg("live: the reply is there", (await rows()).some((text) => text.includes("probe recovered")));

  await runTurn("probe-cut: say anything");
  await sleep(1500);
  leg("pi gave up after its retries", (attempts.get("probe-cut") ?? 0) >= 2, `requests ${String(attempts.get("probe-cut"))}`);
  const liveCut = await failureRows();
  leg("live: exactly one row for the cut reply, and it says interrupted", liveCut.length === 1 && /Interrupted before it finished: .*aborted/u.test(liveCut[0] ?? ""), JSON.stringify(liveCut));

  await page.reload({ waitUntil: "domcontentloaded" });
  leg("precondition: the reloaded page is on this session", await showsThisSession());
  await sleep(1500);
  const reloaded = await failureRows();
  leg("after a reload: the same single interrupted row", reloaded.length === 1 && /Interrupted before it finished/u.test(reloaded[0] ?? ""), JSON.stringify(reloaded));
  leg("after a reload: the recovered reply is still there", (await rows()).some((text) => text.includes("probe recovered")));
  await page.screenshot({ path: "/tmp/journeys/retry-wording.png" });
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? `ALL ${results.length} LEGS PASS` : `${failed} of ${results.length} LEGS FAILED`);
process.exitCode = failed === 0 ? 0 : 1;
