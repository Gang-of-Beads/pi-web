import { createServer } from "node:http";
import { chromium } from "@playwright/test";

/**
 * What a machine announced while the page's socket was down shows once it reopens (state-diagram D5,
 * "A reopen is a miss too", B28 slice H2), 8505, phone 393x850.
 *
 * The probe stands between the page and the daemon (Playwright's routeWebSocket), closes the page's
 * global socket and refuses its reconnects for a while. Meanwhile a session it wrote beforehand (one
 * exchange with the zero-cost fixture model, served here) is renamed elsewhere with the `/name`
 * command. Then the socket may reopen. A session never written is listed nowhere, before or after a
 * reload, so the probe writes one.
 * Legs:
 * - precondition: the board lists the session under its first name, the rename was announced while
 *   the socket was down (the board still shows the first name), and the socket reopened;
 * - after the reopen, the board shows the new name within 8 s;
 * - control: the board was read whole once more, not on every frame.
 * It archives the session it started.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const WORKSPACE_PATH = process.env.PROBE_CWD ?? "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` (${detail})`}`);
};
const api = (path, body) => fetch(`${BASE}/api/machines/local${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const server = createServer((request, response) => {
  request.resume();
  request.on("end", () => {
    const chunk = (delta, finish) => `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "flaky", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(chunk({ role: "assistant", content: "probe warm reply" }, null));
    response.write(chunk({}, "stop"));
    response.end("data: [DONE]\n\n");
  });
});
await new Promise((resolve) => server.listen(18999, "127.0.0.1", resolve));
const browser = await chromium.launch();
let started;
try {
  const answer = await api("/sessions", { cwd: WORKSPACE_PATH });
  started = answer.status === 200 ? await answer.json() : undefined;
  if (started === undefined) throw new Error(`no session: ${String(answer.status)}`);
  const selected = await (await api(`/sessions/${started.id}/model`, { cwd: WORKSPACE_PATH, provider: "pi-web-probe", modelId: "flaky" })).json();
  if (selected?.model?.provider !== "pi-web-probe") throw new Error("the zero-cost fixture model is not selectable; the probe never prompts the machine's default model");
  await api(`/sessions/${started.id}/prompt`, { cwd: WORKSPACE_PATH, text: "warm up" });
  const firstName = `Reopen before ${String(Date.now()).slice(-6)}`;
  await new Promise((resolve) => setTimeout(resolve, 4_000));
  await api(`/sessions/${started.id}/commands/run`, { cwd: WORKSPACE_PATH, text: `/name ${firstName}` });
  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  let refusing = false;
  let opens = 0;
  let current;
  await page.routeWebSocket("**/api/machines/local/events", (socket) => {
    if (refusing) {
      socket.close();
      return;
    }
    opens += 1;
    current = socket;
    const server = socket.connectToServer();
    server.onMessage((message) => { socket.send(message); });
    socket.onMessage((message) => { server.send(message); });
  });
  const boardReads = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname.endsWith("/session-board")) boardReads.push(Date.now()); });
  await page.goto(`${BASE}/?view=sessions`);
  await page.waitForTimeout(8_000);
  const boardRow = (id) => page.evaluate((sessionId) => {
    const board = document.querySelector("pi-web-app")?.sessionBoards?.board("local");
    const row = board?.sessions.find((session) => session.id === sessionId);
    return row === undefined ? undefined : { name: row.name ?? null };
  }, id);

  const before = await boardRow(started.id);
  refusing = true;
  current?.close();
  await page.waitForTimeout(1_500);
  const newName = `Reopen heals ${String(Date.now()).slice(-6)}`;
  const renamed = await api(`/sessions/${started.id}/commands/run`, { cwd: WORKSPACE_PATH, text: `/name ${newName}` });
  await page.waitForTimeout(1_000);
  const whileDown = await boardRow(started.id);
  const readsBeforeReopen = boardReads.length;
  refusing = false;
  const reopenedAt = Date.now();
  let shownAfter;
  for (let waited = 0; waited < 15_000; waited += 250) {
    if ((await boardRow(started.id))?.name === newName) { shownAfter = Date.now() - reopenedAt; break; }
    await page.waitForTimeout(250);
  }
  check("precondition: the board listed the session under its first name, it was renamed while the socket was down, and the socket reopened", readsBeforeReopen >= 1 && before?.name === firstName && renamed.status === 200 && whileDown?.name === firstName && opens === 2, JSON.stringify({ readsBeforeReopen, before, renamed: renamed.status, whileDown, opens }));
  check("after the reopen the board shows the new name within 8 s", shownAfter !== undefined && shownAfter <= 8_000, JSON.stringify({ shownAfterMs: shownAfter ?? "never (15 s)", row: await boardRow(started.id) }));
  check("control: the board was read whole once more, not on every frame", boardReads.length - readsBeforeReopen <= 1, String(boardReads.length - readsBeforeReopen));
  await page.screenshot({ path: "/var/folders/2x/hqbz74zs7fvdxf_53693r26h0000gp/T/.playwright-mcp/h2-reopen-heals-phone.png" });
} finally {
  await browser.close();
  if (started !== undefined) await api(`/sessions/${started.id}/archive`, { cwd: WORKSPACE_PATH }).catch(() => undefined);
  server.close();
}
const failed = results.filter((result) => !result.pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
