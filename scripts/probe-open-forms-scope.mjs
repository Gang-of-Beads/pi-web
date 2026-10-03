import { createServer } from "node:http";
import { chromium } from "@playwright/test";

/**
 * A session's open forms belong to it (state-diagram D2; review b2c94ee9, DeepSeek F4), 8505,
 * phone 393x850.
 *
 * `pendingAsks` was written only by a status, so after the reader moved from a session with open
 * forms to another one, the first session's forms stayed in the state and drew, live, in the
 * second session's chat until its status arrived. The fixture serves `pi-web-probe/flaky` (no real
 * model is prompted): session A's prompt makes the model open two forms; session B gets one plain
 * reply and a name. The phone shows A's two cards, goes to the board and taps B while B's status
 * read is slowed: B's chat must show none of A's cards.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const CWD = process.env.PROBE_CWD ?? `${process.env.HOME}/.pi-web-8505/pi-web-8505-seed-workspace`;
const PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = "ef2cdf93e1ac";
const STAMP = Date.now().toString(36);
const B_NAME = `forms-scope-B-${STAMP}`;
const results = [];
const check = (name, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` (${detail})`}`);
};
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const chunk = (delta, finish) => `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "flaky", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
const form = (id, question) => ({ questions: [{ id, question, options: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }] }] });
const server = createServer((request, response) => {
  let body = "";
  request.on("data", (part) => { body += part; });
  request.on("end", () => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    if (body.includes("forms-scope-open") && !body.includes("call_form_one")) {
      response.write(chunk({ role: "assistant", tool_calls: [
        { index: 0, id: "call_form_one", type: "function", function: { name: "ask_user", arguments: JSON.stringify(form("one", "First form?")) } },
        { index: 1, id: "call_form_two", type: "function", function: { name: "ask_user", arguments: JSON.stringify(form("two", "Second form?")) } },
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
const zeroCost = async (sessionId) => {
  const selected = await api(`sessions/${sessionId}/model`, { provider: "pi-web-probe", modelId: "flaky" });
  if (selected?.model?.provider !== "pi-web-probe") throw new Error("the zero-cost fixture model is not selectable; this probe never prompts a real model");
};
const idle = async (sessionId) => {
  for (let waited = 0; waited < 30_000; waited += 500) {
    if ((await status(sessionId)).isStreaming !== true) return;
    await sleep(500);
  }
};
const waitingCards = (page) => page.evaluate(() => {
  const all = (root, selector) => [...root.querySelectorAll(selector), ...[...root.querySelectorAll("*")].flatMap((node) => (node.shadowRoot === null ? [] : all(node.shadowRoot, selector)))];
  const state = document.querySelector("pi-web-app")?.state;
  return { selected: state?.selectedSession?.id ?? null, view: state?.mainView ?? null, cards: all(document, ".waiting-slot ask-user-card").filter((card) => card.getBoundingClientRect().height > 0).length };
});

const browser = await chromium.launch();
let a;
try {
  a = (await api("sessions", {})).id;
  const b = (await api("sessions", {})).id;
  await zeroCost(a);
  await zeroCost(b);
  await api(`sessions/${b}/prompt`, { text: "say ok" });
  await idle(b);
  await api(`sessions/${b}/commands/run`, { text: `/name ${B_NAME}` });
  await api(`sessions/${a}/prompt`, { text: "forms-scope-open: ask me two things" });
  let open = [];
  for (let waited = 0; waited < 30_000 && open.length < 2; waited += 500) {
    open = (await status(a)).pendingAsks ?? [];
    if (open.length < 2) await sleep(500);
  }
  check("precondition: session A has two open forms", open.length === 2, `${String(open.length)} open`);

  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${a}&view=chat`);
  await page.waitForTimeout(7000);
  const onA = await waitingCards(page);
  check("precondition: A's chat shows its two forms", onA.selected === a && onA.cards === 2, JSON.stringify(onA));

  let slowed = 0;
  await page.route(new RegExp(`/sessions/${b}/status(?:\\?|$)`, "u"), async (route) => {
    slowed += 1;
    await sleep(4000);
    await route.continue();
  });
  await page.locator("app-context-bar button[aria-label='Open navigation']").tap();
  await page.waitForTimeout(1500);
  await page.locator("app-navigate-page button.row.session:visible", { hasText: B_NAME }).first().tap({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  const onB = await waitingCards(page);
  await page.screenshot({ path: "/tmp/surfaces/open-forms-scope-phone.png" });
  check("precondition: B is open, its status read still on its way", onB.selected === b && onB.view === "chat" && slowed > 0, `${JSON.stringify(onB)}, ${String(slowed)} slowed`);
  check("B's chat shows none of A's forms while its status is on its way", onB.cards === 0, JSON.stringify(onB));
  await page.waitForTimeout(5000);
  const settled = await waitingCards(page);
  check("and none once its status has arrived", settled.selected === b && settled.cards === 0, JSON.stringify(settled));
  await context.close();
} finally {
  await browser.close();
  if (a !== undefined) {
    for (const ask of (await status(a)).pendingAsks ?? []) await api(`sessions/${a}/ask/cancel`, { askId: ask.askId });
  }
  server.close();
}
const failed = results.filter((pass) => !pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
