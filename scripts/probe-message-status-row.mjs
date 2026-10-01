import { chromium } from "@playwright/test";

/**
 * The status of a sent message speaks through the app's one row (state-diagram D5, P1 slice 6), 8505,
 * phone 393x850.
 *
 * Owner screenshot, 2026-10-01: a red "Reconnecting to update message status…" notice with Retry and
 * a cross sat at the top while a sent message waited for its status. The probe sends a message while
 * the session's prompt and ledger routes are dropped (the link is down for them only), so the send
 * goes unanswered and every ask of the ledger does too.
 * Legs:
 * - precondition: the message's row says it is waiting for word ("unverifiable");
 * - no notice with Retry is raised, and nothing says "Reconnecting to update message status";
 * - after the grace the app's row says "Reconnecting…" in its own (status) style;
 * - once the routes answer again the ledger is asked, the row is withdrawn, and the message settles.
 * It touches only the session it starts, and archives it at the end.
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
const api = (path, body) => fetch(`${BASE}/api/machines/local${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const created = await api("/sessions", { cwd: CWD });
const sessionId = created.status === 200 ? (await created.json()).id : undefined;
const browser = await chromium.launch();
try {
  check("precondition: the machine started a session", typeof sessionId === "string", String(created.status));
  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${String(sessionId)}&view=chat`);
  await page.waitForTimeout(5_000);
  let dropping = true;
  await page.route(new RegExp(`/sessions/${String(sessionId)}/(prompt|operations)`, "u"), (route) => (dropping ? route.abort("connectionreset") : route.continue()));

  const marker = `status-row ${String(Date.now()).slice(-6)}`;
  await page.locator("prompt-editor .cm-content").first().click({ timeout: 5_000 });
  await page.keyboard.type(marker);
  await page.locator("prompt-editor button.send-button").first().click({ timeout: 5_000 });
  await page.waitForTimeout(1_500);

  const view = () => page.evaluate((text) => {
    const app = document.querySelector("pi-web-app");
    const deep = (root, selector) => [...root.querySelectorAll(selector), ...[...root.querySelectorAll("*")].flatMap((element) => (element.shadowRoot ? deep(element.shadowRoot, selector) : []))];
    const rows = deep(document, ".error").filter((element) => element.checkVisibility());
    const line = app?.state?.messages?.find((candidate) => JSON.stringify(candidate.content ?? "").includes(text) || JSON.stringify(candidate).includes(text));
    return {
      delivery: line?.meta?.delivery?.state ?? null,
      error: app?.state?.error ?? null,
      rows: rows.map((element) => ({ text: element.querySelector(".error-text")?.textContent?.trim() ?? "", role: element.getAttribute("role"), retry: element.querySelector(".error-retry") !== null })),
    };
  }, marker);

  const first = await view();
  check("precondition: the message's row waits for word", first.delivery === "unverifiable", JSON.stringify(first.delivery));
  const samples = [first];
  for (let waited = 0; waited < 12_000; waited += 1_000) {
    await page.waitForTimeout(1_000);
    samples.push(await view());
  }
  const anyRetry = samples.some((sample) => sample.rows.some((row) => row.retry));
  const anyOldWords = samples.some((sample) => sample.rows.some((row) => row.text.includes("Reconnecting to update message status")) || (sample.error ?? "").includes("Reconnecting to update message status"));
  check("no notice with Retry and no \"Reconnecting to update message status\"", !anyRetry && !anyOldWords, JSON.stringify(samples.at(-1)?.rows));
  const reconnecting = samples.at(-1)?.rows.find((row) => row.text.startsWith("Reconnecting"));
  check("after the grace the app's row says reconnecting, as a status", reconnecting !== undefined && reconnecting.role === "status" && !reconnecting.retry, JSON.stringify(samples.at(-1)?.rows));
  await page.screenshot({ path: "/var/folders/2x/hqbz74zs7fvdxf_53693r26h0000gp/T/.playwright-mcp/p1s6-message-status-row-phone.png" });

  dropping = false;
  let cleared;
  for (let waited = 0; waited < 40_000; waited += 1_000) {
    const now = await view();
    if (!now.rows.some((row) => row.text.startsWith("Reconnecting")) && now.delivery !== "unverifiable") { cleared = { at: waited, now }; break; }
    await page.waitForTimeout(1_000);
  }
  check("once the routes answer, the row is withdrawn and the message settles", cleared !== undefined, JSON.stringify(cleared ?? (await view())));
} finally {
  await browser.close();
  if (typeof sessionId === "string") await api(`/sessions/${sessionId}/archive`, { cwd: CWD }).catch(() => undefined);
}
const failed = results.filter((result) => !result.pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
