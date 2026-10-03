import { chromium } from "@playwright/test";

/**
 * A closed card is inert (state-diagram D2, B22), 8505, phone 393x850.
 *
 * While a finger is down on the transcript, a card that closes is kept on screen so nothing moves
 * under the finger. That kept copy stayed live: lifting the finger on its Send key answered a
 * dialog that was already closed. The fixture command `/questions-probe` opens a Questions dialog
 * with no model call. The finger goes down on Send, another client cancels the dialog, and the
 * finger lifts: the page must send nothing. A control opening answered normally proves the request
 * counter sees answers. No session is created and nothing is prompted.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const CWD = `${process.env.HOME}/.pi-web-8505/pi-web-8505-seed-workspace`;
const PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = "ef2cdf93e1ac";
const SESSION = process.env.PROBE_SESSION ?? "01a0fe63-b06a-7019-b764-3740fee34c3f";
const ANSWER = /\/sessions\/[^/]+\/dialogs\/(answer|cancel)$/u;

const results = [];
const check = (name, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` (${detail})`}`);
};
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const post = (path, body) => fetch(`${BASE}/api/sessions/${SESSION}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd: CWD, ...body }) });
const pendingDialogs = async () => (await fetch(`${BASE}/api/sessions/${SESSION}/status?cwd=${encodeURIComponent(CWD)}`).then((response) => response.json())).pendingDialogs ?? [];
const cancelAll = async () => { for (const dialog of await pendingDialogs()) await post("dialogs/cancel", { dialogId: dialog.dialogId }); };
const openQuestions = async () => {
  void post("commands/run", { text: "/questions-probe" }).catch(() => undefined);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(500);
    const open = await pendingDialogs();
    if (open.length > 0) return open[0];
  }
  return undefined;
};

await cancelAll();
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  const answers = [];
  page.on("request", (request) => { if (request.method() === "POST" && ANSWER.test(new URL(request.url()).pathname)) answers.push(new URL(request.url()).pathname); });
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${SESSION}&view=chat`);
  await page.waitForTimeout(6000);
  for (let round = 0; round < 3; round += 1) {
    const cancelUpdater = page.getByRole("button", { name: "Cancel" });
    if (await page.locator("extension-dialog-card").count() === 0) break;
    await cancelUpdater.first().tap({ timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(1000);
  }
  await cancelAll();
  await page.waitForTimeout(1500);

  const card = page.locator("extension-dialog-card.open-dialog-card ask-user-card");
  const control = await openQuestions();
  const controlShown = await card.first().waitFor({ state: "visible", timeout: 20_000 }).then(() => true, () => false);
  check("precondition: /questions-probe opens a Questions card", control !== undefined && controlShown, String(control?.dialogId));
  await card.locator("label.option", { hasText: "Beta" }).tap();
  await card.getByRole("button", { name: "Send answers" }).tap();
  await page.waitForTimeout(2000);
  check("control: a tap on a live card's Send answers it", answers.length > 0 && (await pendingDialogs()).length === 0, answers.join(", "));

  answers.length = 0;
  const dialog = await openQuestions();
  const shown = await card.first().waitFor({ state: "visible", timeout: 20_000 }).then(() => true, () => false);
  check("precondition: a second opening shows the card again", dialog !== undefined && shown, String(dialog?.dialogId));
  await card.locator("label.option", { hasText: "Beta" }).tap();
  const send = card.getByRole("button", { name: "Send answers" });
  const box = await send.boundingBox();
  if (box === null) throw new Error("Send answers has no box");
  const cdp = await context.newCDPSession(page);
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  await post("dialogs/cancel", { dialogId: dialog.dialogId });
  await page.waitForTimeout(2500);
  const held = await page.evaluate(() => {
    const find = (root) => {
      for (const element of root.querySelectorAll("*")) {
        if (element.classList?.contains("waiting-slot")) return element;
        if (element.shadowRoot !== null) { const inner = find(element.shadowRoot); if (inner) return inner; }
      }
      return undefined;
    };
    const slot = find(document);
    return { present: slot !== undefined, inert: slot?.hasAttribute("inert") ?? false };
  });
  check("precondition: the machine has closed the dialog while the finger is down", (await pendingDialogs()).length === 0);
  check("the closed card stays under the finger", held.present, JSON.stringify(held));
  check("and it is inert while it is held", held.inert, JSON.stringify(held));
  await page.screenshot({ path: "/tmp/surfaces/held-card-phone.png" });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(2000);
  check("lifting the finger on its Send sends nothing", answers.length === 0, answers.join(", "));
  await context.close();
} finally {
  await browser.close();
  await cancelAll();
}
const failed = results.filter((pass) => !pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
