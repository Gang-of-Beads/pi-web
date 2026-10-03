import { chromium } from "@playwright/test";

/**
 * A refused dialog is a state the reader sees (state-diagram D2, B10), 8505, phone 393x850.
 *
 * The owner met "dialog title exceeds its length limit" only as a failure inside the goal
 * extension: the host refused the dialog and the screen showed nothing. The fixture command
 * `/refused-dialog-probe` asks for a select with no options, which the host refuses. The open chat
 * must say so; the extension still gets its rejection. A control (`/long-confirm-probe`, a
 * dialog the host accepts) proves the chat shows what the daemon publishes. No session is created
 * and nothing is prompted.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const CWD = `${process.env.HOME}/.pi-web-8505/pi-web-8505-seed-workspace`;
const PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = "ef2cdf93e1ac";
const SESSION = process.env.PROBE_SESSION ?? "01a0fe63-b06a-7019-b764-3740fee34c3f";
const WORDS = "An extension asked something PI WEB could not show";
const results = [];
const check = (name, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` (${detail})`}`);
};
const post = (path, body) => fetch(`${BASE}/api/sessions/${SESSION}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd: CWD, ...body }) });
const pendingDialogs = async () => (await fetch(`${BASE}/api/sessions/${SESSION}/status?cwd=${encodeURIComponent(CWD)}`).then((response) => response.json())).pendingDialogs ?? [];
const cancelAll = async () => { for (const dialog of await pendingDialogs()) await post("dialogs/cancel", { dialogId: dialog.dialogId }); };
const chatText = (page) => page.evaluate(() => {
  const all = (root, selector) => [...root.querySelectorAll(selector), ...[...root.querySelectorAll("*")].flatMap((node) => (node.shadowRoot === null ? [] : all(node.shadowRoot, selector)))];
  const deepText = (node) => [...node.childNodes].map((child) => (child.nodeType === 3 ? child.textContent : deepText(child))).join(" ") + (node.shadowRoot ? ` ${deepText(node.shadowRoot)}` : "");
  return all(document, "chat-view").map((view) => { const chat = view.shadowRoot?.querySelector(".chat"); return chat ? deepText(chat) : ""; }).join(" ").replace(/\s+/gu, " ");
});

await cancelAll();
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${SESSION}&view=chat`);
  await page.waitForTimeout(7000);
  await cancelAll();
  check("precondition: the chat does not already show the words", !(await chatText(page)).includes(WORDS));

  void post("commands/run", { text: "/long-confirm-probe" }).catch(() => undefined);
  const control = await page.locator("extension-dialog-card").first().waitFor({ state: "visible", timeout: 20_000 }).then(() => true, () => false);
  check("control: a dialog the host accepts shows in the chat", control);
  await cancelAll();
  await page.waitForTimeout(1500);

  await post("commands/run", { text: "/refused-dialog-probe" });
  let said = false;
  for (let waited = 0; waited < 8000 && !said; waited += 500) {
    said = (await chatText(page)).includes(WORDS);
    if (!said) await page.waitForTimeout(500);
  }
  check("precondition: the refused dialog opened nothing", (await pendingDialogs()).length === 0);
  check("the chat says the extension asked something it could not show", said);
  await page.screenshot({ path: "/tmp/surfaces/refused-dialog-phone.png" });
  await context.close();
} finally {
  await browser.close();
  await cancelAll();
}
const failed = results.filter((pass) => !pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
