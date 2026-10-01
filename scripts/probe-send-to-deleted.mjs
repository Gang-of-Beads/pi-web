import { createServer } from "node:http";
import { chromium } from "@playwright/test";

/**
 * A message sent to a session that was deleted meanwhile says so at the top (owner, 2026-10-01:
 * "如果是就直接报错啊在上面"), 8505, phone 393x850.
 *
 * "Deleted meanwhile" is a delete this page did not hear: another device archived and deleted the
 * session while this page's live connection was down. The probe keeps the page's socket shut (its
 * URL is rewritten to a closed port), so the page still shows the session, then archives and
 * deletes it through the API, and sends from the composer.
 * Legs:
 * - precondition: the session opened with its warm-up reply, and the machine answers it not found
 *   after the delete;
 * - the notice at the top says the session no longer exists and the message was not sent, in the
 *   words of the session's own page, not the daemon's "Session not found";
 * - the typed words are back in the composer;
 * - no row for the message is left in the transcript;
 * - Retry, like every reader notice's, opens the session again, which lands on its own page saying it
 *   no longer exists; it never sends the message.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const CWD = process.env.PROBE_CWD ?? "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";
const PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = "ef2cdf93e1ac";
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` (${detail})`}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const api = async (path, body) => {
  const response = await fetch(`${BASE}/api/machines/local${path}`, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: text === "" ? undefined : JSON.parse(text) };
};

let sessionId;
const browser = await chromium.launch();
try {
  const created = await api("/sessions", { cwd: CWD });
  sessionId = created.body?.id;
  await api(`/sessions/${String(sessionId)}/model`, { cwd: CWD, provider: "pi-web-probe", modelId: "flaky" });
  await api(`/sessions/${String(sessionId)}/prompt`, { cwd: CWD, text: "warm up" });
  for (let waited = 0; waited < 60_000; waited += 1_000) {
    const status = await api(`/sessions/${String(sessionId)}/status?cwd=${encodeURIComponent(CWD)}`);
    if (status.body?.isStreaming === false && status.body?.messageCount > 0) break;
    await sleep(1_000);
  }

  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  await context.addInitScript(() => {
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(url, protocols) { super("ws://127.0.0.1:9/", protocols); void url; }
    };
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${String(sessionId)}&view=chat`);
  await page.waitForTimeout(5_000);
  const opened = await page.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    return { selected: app?.state?.selectedSession?.id ?? null, replies: (app?.state?.messages ?? []).filter((line) => line.role === "assistant").length };
  });

  const archived = await api("/sessions/bulk/archive", { sessions: [{ id: sessionId, cwd: CWD }] });
  const deleted = await api("/sessions/bulk/delete-archived", { sessions: [{ id: sessionId, cwd: CWD }] });
  const located = await api(`/sessions/${String(sessionId)}/locate?cwd=${encodeURIComponent(CWD)}`);
  check("precondition: the page shows the session, and the machine answers it not found after the delete", opened.selected === sessionId && opened.replies > 0 && located.status === 404 && located.body?.code === "session-not-found", JSON.stringify({ opened, archived: archived.status, deleted: deleted.status, located: located.status }));

  const words = `sent after the delete ${String(Date.now()).slice(-5)}`;
  await page.locator("prompt-editor .cm-content").first().click({ timeout: 5_000 });
  await page.keyboard.type(words);
  await page.locator("prompt-editor button.send-button").first().click({ timeout: 5_000 });
  await page.waitForTimeout(3_000);

  const after = await page.evaluate((text) => {
    const app = document.querySelector("pi-web-app");
    const deep = (root, selector) => [...root.querySelectorAll(selector), ...[...root.querySelectorAll("*")].flatMap((element) => (element.shadowRoot ? deep(element.shadowRoot, selector) : []))];
    const notices = deep(document, ".error").filter((element) => element.checkVisibility()).map((element) => ({ text: element.querySelector(".error-text")?.textContent?.trim() ?? element.textContent.trim(), retry: element.querySelector(".error-retry") !== null }));
    const composer = deep(document, ".cm-content").map((element) => element.textContent ?? "").join("\n");
    const rows = (app?.state?.messages ?? []).filter((line) => JSON.stringify(line).includes(text)).map((line) => line.meta?.delivery?.state ?? line.role);
    return { notices, composer, rows, error: app?.state?.error ?? null, url: window.location.search };
  }, words);
  await page.screenshot({ path: "/var/folders/2x/hqbz74zs7fvdxf_53693r26h0000gp/T/.playwright-mcp/send-to-deleted-phone.png" });
  const goneNotice = after.notices.find((notice) => notice.text === "This session no longer exists, so your message was not sent.");
  check("the notice at the top says the session no longer exists and the message was not sent", goneNotice !== undefined, JSON.stringify(after.notices));
  check("the typed words are back in the composer", after.composer.includes(words), JSON.stringify(after.composer.slice(0, 120)));
  check("no row for the message is left in the transcript", after.rows.length === 0, JSON.stringify(after.rows));
  const prompts = [];
  page.on("request", (request) => { if (request.method() === "POST" && request.url().includes("/prompt")) prompts.push(request.url()); });
  await page.evaluate(() => {
    const deep = (root, selector) => [...root.querySelectorAll(selector), ...[...root.querySelectorAll("*")].flatMap((element) => (element.shadowRoot ? deep(element.shadowRoot, selector) : []))];
    deep(document, ".error-retry").find((element) => element.checkVisibility())?.click();
  });
  await page.waitForTimeout(4_000);
  const retried = await page.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    const deep = (root, selector) => [...root.querySelectorAll(selector), ...[...root.querySelectorAll("*")].flatMap((element) => (element.shadowRoot ? deep(element.shadowRoot, selector) : []))];
    const visible = deep(document, "*").filter((element) => element.children.length === 0 && element.checkVisibility() && /no longer exists on/u.test(element.textContent ?? "")).map((element) => element.textContent.trim());
    return { selected: app?.state?.selectedSession?.id ?? null, gonePage: visible[0] ?? null };
  });
  check("Retry opens the session again, which says it no longer exists, and sends nothing", retried.selected === null && retried.gonePage !== null && prompts.length === 0, JSON.stringify({ ...retried, prompts: prompts.length }));
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((result) => !result.pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
