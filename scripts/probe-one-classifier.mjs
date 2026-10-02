import { createServer } from "node:http";
import { chromium } from "@playwright/test";

/**
 * Every surface says the same state for the same session (B14, state-diagram D3), 8505.
 *
 * The chat dock, the quick switcher and the Go to page each derived a session's state on their
 * own, so the same session could read "Waiting for you" on the Go to page and "Waiting for your
 * answer" in the switcher, in a different colour, or idle on one and error on the other. This probe
 * serves the `pi-web-probe/flaky` model that ~/.pi/agent/extensions/ui-custom-probe.ts registers on
 * 8505: one session's prompt makes it ask a question, the other's runs `bash sleep`. No real model
 * is prompted. Both sessions are archived afterwards.
 *
 * - The Go to page (phone, 393x850) and the quick switcher (desktop, mod+p) give each session the
 *   same mark: "Waiting for your answer" for the asking one, "Session is working" for the running one.
 * - The dock of the running session is in the working category. pi-updater opens update dialogs
 *   in new sessions on 8505; the probe keeps closing them so the running session stays working.
 * - A third session opens a dialog (`/ui-custom-probe`), then, while the phone page is open, its
 *   shell command fails: a question waiting for the reader outranks the failure before it (D3
 *   precedence, B14 review 6bf7aee1), so both surfaces give it the asking mark. Before, the
 *   classifier put the failure first and the phone's Go to page said "Session hit an error".
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const CWD = process.env.PROBE_CWD ?? "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";
const PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = "ef2cdf93e1ac";
const HOME_SESSION = "01a05000-5eed-7c00-8000-0000000000e1";
const STAMP = String(Date.now()).slice(-6);
const ASK_NAME = `classify ask ${STAMP}`;
const RUN_NAME = `classify run ${STAMP}`;
const FAIL_NAME = `classify fail ${STAMP}`;
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
    const answered = body.includes("call_classify");
    if (body.includes("probe-classify-ask") && !answered) {
      const ask = { questions: [{ id: "q", question: "Which one?", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }] };
      response.write(chunk({ role: "assistant", tool_calls: [{ index: 0, id: "call_classify_ask", type: "function", function: { name: "ask_user", arguments: JSON.stringify(ask) } }] }, null));
      response.write(chunk({}, "tool_calls"));
    } else if (body.includes("probe-classify-run") && !answered) {
      response.write(chunk({ role: "assistant", tool_calls: [{ index: 0, id: "call_classify_run", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: "sleep 40" }) } }] }, null));
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

async function startSession(name, prompt) {
  const sessionId = (await api("sessions", {})).id;
  const selected = await api(`sessions/${sessionId}/model`, { provider: "pi-web-probe", modelId: "flaky" });
  if (selected?.model?.provider !== "pi-web-probe") throw new Error("the zero-cost fixture model is not selectable; this probe never prompts a real model");
  await api(`sessions/${sessionId}/commands/run`, { text: `/name ${name}` });
  await api(`sessions/${sessionId}/prompt`, { text: prompt });
  return sessionId;
}

async function waitFor(read, ready, limitMs) {
  for (let waited = 0; waited < limitMs; waited += 250) {
    const value = await read();
    if (ready(value)) return value;
    await sleep(250);
  }
  return undefined;
}

const markIn = (page, host, rowSelector, name) => page.evaluate(({ host, rowSelector, name }) => {
  const all = (root, selector) => [...root.querySelectorAll(selector), ...[...root.querySelectorAll("*")].flatMap((node) => (node.shadowRoot === null ? [] : all(node.shadowRoot, selector)))];
  const surfaces = all(document, host);
  const rows = surfaces.flatMap((surface) => [...(surface.shadowRoot?.querySelectorAll(rowSelector) ?? [])]).filter((row) => row.getClientRects().length > 0 && row.textContent.includes(name));
  const mark = rows[0]?.querySelector(".session-state, .state");
  return rows.length === 0 ? "no row" : (mark?.getAttribute("aria-label") ?? "no mark");
}, { host, rowSelector, name });

const browser = await chromium.launch();
const sessions = [];
const kept = [];
let dialogCloser;
try {
  const failing = await startSession(FAIL_NAME, "probe-classify-fail: say ok");
  kept.push(failing);
  await waitFor(() => status(failing), (state) => state.isStreaming !== true && state.activity?.phase !== "active", 30_000);
  void api(`sessions/${failing}/commands/run`, { text: "/ui-custom-probe" }).catch(() => undefined);
  const dialogOpen = await waitFor(() => status(failing), (state) => (state.pendingDialogs ?? []).length > 0, 20_000);
  const asking = await startSession(ASK_NAME, "probe-classify-ask: ask me something");
  const running = await startSession(RUN_NAME, "probe-classify-run: run a long command");
  sessions.push(asking, running);
  console.log("sessions:", asking, running);
  const askReady = await waitFor(() => status(asking), (state) => state.pendingAsk !== undefined, 30_000);
  const runReady = await waitFor(() => status(running), (state) => state.isStreaming === true, 30_000);
  const closeDialogs = async () => {
    for (const sessionId of sessions) {
      for (const dialog of (await status(sessionId)).pendingDialogs ?? []) await api(`sessions/${sessionId}/dialogs/cancel`, { dialogId: dialog.dialogId });
    }
  };
  await closeDialogs();
  dialogCloser = setInterval(() => { void closeDialogs().catch(() => undefined); }, 1000);
  const quiet = await waitFor(() => Promise.all(sessions.map(status)), (states) => states.every((state) => (state.pendingDialogs ?? []).length === 0), 15_000) !== undefined;
  check("precondition: one session asks, the other runs, and no extension dialog (pi-updater opens one in a new session) is open", askReady !== undefined && runReady !== undefined && quiet);

  const phone = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await phone.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const phonePage = await phone.newPage();
  await phonePage.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${running}&view=chat`);
  await phonePage.waitForTimeout(6000);
  const dockClass = await phonePage.evaluate(() => {
    const all = (root, selector) => [...root.querySelectorAll(selector), ...[...root.querySelectorAll("*")].flatMap((node) => (node.shadowRoot === null ? [] : all(node.shadowRoot, selector)))];
    return all(document, ".activity-dock")[0]?.getAttribute("class") ?? "";
  });
  check("the running session's dock is in the working category", dockClass.split(" ").includes("working"), JSON.stringify(dockClass));
  await phonePage.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${HOME_SESSION}&view=chat`);
  await phonePage.waitForTimeout(5000);
  await api(`sessions/${failing}/shell`, { text: "!exit 3" });
  const failReady = await waitFor(() => status(failing), (state) => state.activity?.phase === "error" && (state.pendingDialogs ?? []).length > 0, 20_000);
  check("precondition: the third session's shell command failed while a dialog is open in it", dialogOpen !== undefined && failReady !== undefined, JSON.stringify((await status(failing)).activity ?? null));
  const learned = await waitFor(() => phonePage.evaluate((id) => document.querySelector("pi-web-app")?.state?.sessionActivities?.[id]?.phase ?? null, failing), (phase) => phase === "error", 10_000);
  check("precondition: the open phone page learned the failure from the live event", learned === "error");
  await phonePage.locator("app-context-bar button[aria-label='Open navigation']").tap();
  await phonePage.waitForTimeout(2500);
  console.log("page facts for the failed session:", JSON.stringify(await phonePage.evaluate((id) => { const state = document.querySelector("pi-web-app")?.state; return { activity: state?.sessionActivities?.[id] ?? null, dialogs: (state?.sessionStatuses?.[id]?.pendingDialogs ?? []).length, hasStatus: state?.sessionStatuses?.[id] !== undefined }; }, failing)));
  const goTo = { ask: await markIn(phonePage, "app-navigate-page", "button.row.session", ASK_NAME), run: await markIn(phonePage, "app-navigate-page", "button.row.session", RUN_NAME), fail: await markIn(phonePage, "app-navigate-page", "button.row.session", FAIL_NAME) };
  await phonePage.screenshot({ path: "/tmp/surfaces/one-classifier-goto-phone.png" });
  await phone.close();

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await desktop.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const desktopPage = await desktop.newPage();
  await desktopPage.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${HOME_SESSION}&view=chat`);
  await desktopPage.waitForTimeout(6000);
  await desktopPage.keyboard.press("ControlOrMeta+p");
  await desktopPage.waitForTimeout(2000);
  const switcher = { ask: await markIn(desktopPage, "quick-switcher", "button.session-row", ASK_NAME), run: await markIn(desktopPage, "quick-switcher", "button.session-row", RUN_NAME), fail: await markIn(desktopPage, "quick-switcher", "button.session-row", FAIL_NAME) };
  await desktopPage.screenshot({ path: "/tmp/surfaces/one-classifier-switcher-desktop.png" });
  await desktop.close();

  console.log("go to:", JSON.stringify(goTo), "switcher:", JSON.stringify(switcher));
  check("precondition: both surfaces list all three sessions", ![goTo.ask, goTo.run, goTo.fail, switcher.ask, switcher.run, switcher.fail].includes("no row"));
  check("the asking session wears the same mark on the Go to page and in the switcher", goTo.ask === switcher.ask && switcher.ask === "Waiting for your answer", `${goTo.ask} / ${switcher.ask}`);
  check("the running session wears the same mark on the Go to page and in the switcher", goTo.run === switcher.run && switcher.run === "Session is working", `${goTo.run} / ${switcher.run}`);
  check("a failed session with a dialog open wears the asking mark on both surfaces", goTo.fail === switcher.fail && switcher.fail === "Waiting for your answer", `${goTo.fail} / ${switcher.fail}`);
} finally {
  clearInterval(dialogCloser);
  await browser.close();
  server.close();
  for (const sessionId of [...sessions, ...kept]) {
    const state = await status(sessionId).catch(() => ({}));
    for (const dialog of state.pendingDialogs ?? []) await api(`sessions/${sessionId}/dialogs/cancel`, { dialogId: dialog.dialogId }).catch(() => undefined);
    if (state.pendingAsk !== undefined) await api(`sessions/${sessionId}/ask/cancel`, { askId: state.pendingAsk.askId }).catch(() => undefined);
    await api(`sessions/${sessionId}/abort`, {}).catch(() => undefined);
    await api(`sessions/${sessionId}/archive`, {}).catch(() => undefined);
  }
}
const failed = results.filter((pass) => !pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
