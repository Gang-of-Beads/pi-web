import { createServer } from "node:http";
import { chromium } from "@playwright/test";

/**
 * An old message never comes back by itself (B4, state-diagram D1 "Automatic resend"), 8505,
 * phone 393x850.
 *
 * The owner saw old messages suddenly reappear in the queue. The composer's outbox replayed every
 * record that stopped without an answer on `online`, on the first render and on a session switch,
 * whatever its age, so a message stranded hours ago was sent the next time the page loaded. D1
 * says the outbox resends by itself only a message not sent from this device in the last 10
 * minutes; an unverifiable one is asked of the ledger, never resent blindly; anything older waits
 * for the reader's Retry.
 *
 * The probe plants three records in the page's outbox before it loads: one not sent a minute ago
 * (the control: replay must still send it), one not sent two hours ago and one unverifiable two
 * hours ago (neither may reach the daemon). It serves the `pi-web-probe/flaky` model that
 * ~/.pi/agent/extensions/ui-custom-probe.ts registers on 8505; no real model is prompted, and the
 * session is archived afterwards.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const CWD = process.env.PROBE_CWD ?? "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";
const PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = "ef2cdf93e1ac";
const STAMP = String(Date.now()).slice(-6);
const FRESH = `fresh not sent ${STAMP}`;
const OLD_NOT_SENT = `old not sent ${STAMP}`;
const OLD_UNVERIFIABLE = `old unverifiable ${STAMP}`;
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
const transcript = async (sessionId) => JSON.stringify(await api(`sessions/${sessionId}/messages?cwd=${encodeURIComponent(CWD)}`).catch(() => ({})));

async function waitFor(read, ready, limitMs) {
  for (let waited = 0; waited < limitMs; waited += 250) {
    const value = await read();
    if (ready(value)) return value;
    await sleep(250);
  }
  return undefined;
}

const browser = await chromium.launch();
let sessionId;
let dialogCloser;
try {
  sessionId = (await api("sessions", {})).id;
  console.log("session:", sessionId);
  const selected = await api(`sessions/${sessionId}/model`, { provider: "pi-web-probe", modelId: "flaky" });
  if (selected?.model?.provider !== "pi-web-probe") throw new Error("the zero-cost fixture model is not selectable; this probe never prompts a real model");
  dialogCloser = setInterval(() => {
    void status(sessionId).then(async (state) => {
      for (const dialog of state.pendingDialogs ?? []) await api(`sessions/${sessionId}/dialogs/cancel`, { dialogId: dialog.dialogId });
    }).catch(() => undefined);
  }, 1000);
  await api(`sessions/${sessionId}/prompt`, { text: "probe-stale: say ok" });
  const settled = await waitFor(() => status(sessionId), (state) => state.isStreaming !== true && (state.messageCount ?? 0) >= 2, 20_000);
  check("precondition: the session answered its first prompt and is idle", settled !== undefined);

  const now = Date.now();
  const record = (text, state, ageMs, extra) => ({ state, text, behavior: "followUp", clientMessageId: `probe-${text.replaceAll(" ", "-")}`, at: new Date(now - ageMs).toISOString(), ...extra });
  const outbox = [
    record(OLD_UNVERIFIABLE, "unverifiable", 2 * 3_600_000, {}),
    record(OLD_NOT_SENT, "failed", 2 * 3_600_000, { failure: "not-sent" }),
    record(FRESH, "failed", 60_000, { failure: "not-sent" }),
  ];
  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  await context.addInitScript(({ key, value }) => {
    if (sessionStorage.getItem("probe-outbox-planted") === "1") return;
    sessionStorage.setItem("probe-outbox-planted", "1");
    localStorage.setItem(key, value);
  }, { key: `pi-web:pending-prompt:local:${sessionId}`, value: JSON.stringify(outbox) });
  const page = await context.newPage();
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${sessionId}&view=chat`);
  const freshSent = await waitFor(() => transcript(sessionId), (body) => body.includes(FRESH), 20_000);
  await page.waitForTimeout(4000);
  const after = await transcript(sessionId);
  check("precondition: the outbox replayed the message not sent a minute ago", freshSent !== undefined);
  check("a message not sent two hours ago is not resent by itself", !after.includes(OLD_NOT_SENT));
  check("an unverifiable message from two hours ago is not resent by itself", !after.includes(OLD_UNVERIFIABLE));
  const offered = await page.evaluate(() => {
    const texts = [];
    const walk = (root) => {
      for (const node of root.querySelectorAll("*")) {
        if (node.shadowRoot === null) continue;
        texts.push(node.shadowRoot.textContent ?? "");
        walk(node.shadowRoot);
      }
    };
    walk(document);
    return texts.join(" ");
  });
  check("both old messages are still on the page for the reader to retry or discard", offered.includes(OLD_NOT_SENT) && offered.includes(OLD_UNVERIFIABLE), offered.slice(0, 300));
  await page.screenshot({ path: "/tmp/surfaces/outbox-stale-phone.png" });
  await context.close();
} finally {
  clearInterval(dialogCloser);
  await browser.close();
  server.close();
  if (sessionId !== undefined) await api(`sessions/${sessionId}/archive`, {}).catch(() => undefined);
}
const failed = results.filter((pass) => !pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
