import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

/**
 * An extension screen declared as questions is the Questions card, shown once.
 *
 * The owner had to close a terminal dump before the goal extension's native
 * dialogs appeared. `ctx.ui.custom(factory, { web: { kind: "questions" } })` now
 * opens the Questions card and never mounts the terminal component. The fixture
 * command `/questions-probe` (~/.pi/agent/extensions/ui-custom-probe.ts, loaded
 * when PI_WEB_UI_CUSTOM_PROBE=1) opens such a screen and logs what it gets back.
 *
 * Legs, each failing loudly: the card is the Questions card (no terminal frame,
 * no key row); it carries the declared detail and exactly the declared options;
 * the factory never ran; a tap on a coarse 393x850 screen plus Send delivers the
 * answer to the extension; the card closes, and the notification drawer (where an
 * answered dialog is filed) names the chosen label rather than its value. A second
 * opening carries the declared title and closes on Cancel with no answer.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const CWD = process.env.PROBE_CWD ?? "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";
const PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = "ef2cdf93e1ac";
const LOG = process.env.PROBE_DAEMON_LOG ?? `${process.env.HOME}/.pi-web-8505/logs/sessiond.log`;
const EXPECTED = '[ui-questions-probe] returned {"answers":[{"id":"pick","values":["b"]}]}';

const results = [];
function leg(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` - ${detail}`}`);
}
const logText = () => { try { return readFileSync(LOG, "utf8"); } catch { return ""; } };
const occurrences = (needle) => logText().split(needle).length - 1;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const created = await fetch(`${BASE}/api/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd: CWD }) }).then((response) => response.json());
const sessionId = created.id;
if (typeof sessionId !== "string") throw new Error(`no session was created: ${JSON.stringify(created)}`);
console.log("session:", sessionId);
const post = (path, body) => fetch(`${BASE}/api/sessions/${sessionId}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd: CWD, ...body }) });
const status = () => fetch(`${BASE}/api/sessions/${sessionId}/status?cwd=${encodeURIComponent(CWD)}`).then((response) => response.json());

await post("prompt", { text: "say ok" });
for (let attempt = 0; attempt < 60; attempt += 1) {
  await sleep(2000);
  const now = await status();
  if (now.isStreaming !== true) break;
}
for (const dialog of (await status()).pendingDialogs ?? []) await post("dialogs/cancel", { dialogId: dialog.dialogId });

const factoryRunsBefore = occurrences("[ui-questions-probe] factory ran");
const answersBefore = occurrences(EXPECTED);
void post("commands/run", { text: "/questions-probe" }).catch(() => undefined);

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${sessionId}&view=chat`, { waitUntil: "domcontentloaded" });
  const card = page.locator("extension-dialog-card.open-dialog-card");
  const questions = card.locator("ask-user-card");
  const opened = await questions.first().waitFor({ state: "visible", timeout: 60_000 }).then(() => true, () => false);
  leg("the declared screen opens as the Questions card", opened);
  if (!opened) throw new Error("no Questions card appeared");

  leg("no terminal frame or key row is drawn", await card.locator(".dialog-screen, .dialog-screen-menu, .dialog-screen-keys").count() === 0);
  const detail = (await questions.locator(".question-detail").textContent()) ?? "";
  leg("the card carries the declared detail", detail === "Probe detail", JSON.stringify(detail));
  const labels = await questions.locator(".option-label").allTextContents();
  leg("the card offers exactly the declared options, no Custom", JSON.stringify(labels) === JSON.stringify(["Alpha", "Beta"]), JSON.stringify(labels));
  leg("the terminal component was never mounted", occurrences("[ui-questions-probe] factory ran") === factoryRunsBefore);
  await page.screenshot({ path: "/tmp/journeys/questions-screen.png" });

  await questions.locator("label.option", { hasText: "Beta" }).tap();
  await questions.getByRole("button", { name: "Send answers" }).tap();
  let delivered = false;
  for (let attempt = 0; attempt < 30 && !delivered; attempt += 1) {
    await sleep(500);
    delivered = occurrences(EXPECTED) > answersBefore;
  }
  leg("the tapped answer reaches the extension", delivered);
  await sleep(1000);
  const stillOpen = await card.count();
  const notices = await fetch(`${BASE}/api/sessions/${sessionId}/notifications?cwd=${encodeURIComponent(CWD)}`).then((response) => response.json());
  const strings = (value) => (typeof value === "string" ? [value] : typeof value === "object" && value !== null ? Object.values(value).flatMap(strings) : []);
  const texts = strings(notices).filter((text) => text.startsWith("Answered "));
  leg("the card closes and the notification names the label", stillOpen === 0 && texts.some((text) => text.includes("Questions probe") && text.endsWith("Beta")), JSON.stringify({ stillOpen, texts }));

  const cancelsBefore = occurrences("[ui-questions-probe] returned undefined");
  void post("commands/run", { text: "/questions-probe" }).catch(() => undefined);
  const reopened = await questions.first().waitFor({ state: "visible", timeout: 60_000 }).then(() => true, () => false);
  leg("the card's heading is the declared title", reopened && (await questions.locator("h2").first().textContent()) === "Questions probe");
  if (reopened) await questions.getByRole("button", { name: "Cancel" }).tap();
  let cancelled = false;
  for (let attempt = 0; attempt < 30 && !cancelled; attempt += 1) {
    await sleep(500);
    cancelled = occurrences("[ui-questions-probe] returned undefined") > cancelsBefore;
  }
  leg("Cancel closes the card and the extension gets no answer", cancelled && await card.count() === 0);
} finally {
  await browser.close();
}

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? `ALL ${results.length} LEGS PASS` : `${failed} of ${results.length} LEGS FAILED`);
process.exitCode = failed === 0 ? 0 : 1;
