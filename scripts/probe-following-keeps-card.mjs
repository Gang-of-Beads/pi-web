import { chromium } from "@playwright/test";

/**
 * Following keeps a docked card at the bottom through any growth (state-diagram D4, B12), 8505,
 * phone 393x850.
 *
 * The product audit measured it: at the bottom with a card open, one appended row left a 127 px
 * gap and hid the card's Close. The fixture command `/long-confirm-probe` docks a tall card; then
 * a shell run (`!echo`, no model call) appends rows to the transcript while the reader has not
 * touched anything. The transcript must still end at the bottom, with the card's action row on
 * screen, and the reader still following: a view that grew lowered `scrollTop` to keep the bottom,
 * and that scroll read as the reader scrolling up. No session is created and nothing is prompted.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const CWD = `${process.env.HOME}/.pi-web-8505/pi-web-8505-seed-workspace`;
const PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = "ef2cdf93e1ac";
const SESSION = process.env.PROBE_SESSION ?? "01a0fe63-b06a-7019-b764-3740fee34c3f";
const results = [];
const check = (name, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` (${detail})`}`);
};
const post = (path, body) => fetch(`${BASE}/api/sessions/${SESSION}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd: CWD, ...body }) });
const pendingDialogs = async () => (await fetch(`${BASE}/api/sessions/${SESSION}/status?cwd=${encodeURIComponent(CWD)}`).then((response) => response.json())).pendingDialogs ?? [];
const cancelAll = async () => { for (const dialog of await pendingDialogs()) await post("dialogs/cancel", { dialogId: dialog.dialogId }); };
const facts = (page) => page.evaluate(() => {
  const view = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view");
  const chat = view?.shadowRoot?.querySelector(".chat");
  const card = view?.shadowRoot?.querySelector("extension-dialog-card");
  const actions = [...(card?.shadowRoot?.querySelectorAll("button") ?? [])].filter((button) => /Cancel|Yes|No|OK|Confirm/u.test(button.textContent ?? ""));
  const chatBox = chat?.getBoundingClientRect();
  const visible = actions.filter((button) => { const box = button.getBoundingClientRect(); return chatBox !== undefined && box.height > 0 && box.top >= chatBox.top && box.bottom <= chatBox.bottom + 1; }).length;
  return {
    rows: document.querySelector("pi-web-app")?.state?.messages?.length ?? null,
    fromBottom: chat === null || chat === undefined ? null : Math.round(chat.scrollHeight - chat.scrollTop - chat.clientHeight),
    overflow: chat === null || chat === undefined ? null : Math.round(chat.scrollHeight - chat.clientHeight),
    viewport: view?.viewportState?.kind ?? null,
    pinned: view?.pinnedToBottom ?? null,
    card: card !== null && card !== undefined,
    actions: actions.length,
    actionsOnScreen: visible,
  };
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
  await page.waitForTimeout(1500);
  void post("commands/run", { text: "/long-confirm-probe" }).catch(() => undefined);
  await page.locator("extension-dialog-card").first().waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(2000);
  const docked = await facts(page);
  check("docking the card leaves the reader at the bottom, following", docked.card && docked.fromBottom !== null && docked.fromBottom <= 2 && docked.viewport === "following" && docked.actionsOnScreen > 0, JSON.stringify(docked));
  check("precondition: the transcript overflows, so the bottom is a place it could leave", docked.overflow !== null && docked.overflow > 200, JSON.stringify(docked));

  await post("prompt", { text: "!echo following-keeps-card" });
  let grown = docked;
  for (let waited = 0; waited < 6000 && grown.overflow === docked.overflow; waited += 250) {
    await page.waitForTimeout(250);
    grown = await facts(page);
  }
  await page.waitForTimeout(1500);
  const after = await facts(page);
  check("precondition: the transcript grew without the reader touching anything", after.overflow !== null && docked.overflow !== null && after.overflow > docked.overflow + 20, `${String(docked.overflow)} -> ${String(after.overflow)} px`);
  check("the transcript still ends at the bottom", after.fromBottom !== null && after.fromBottom <= 2, JSON.stringify(after));
  check("and the card's action row is still on screen", after.actionsOnScreen > 0, JSON.stringify(after));
  await page.waitForTimeout(3000);
  const settled = await facts(page);
  check("and the reader is still following, having touched nothing", settled.viewport === "following" && settled.fromBottom !== null && settled.fromBottom <= 2, JSON.stringify(settled));
  await page.screenshot({ path: "/tmp/surfaces/following-keeps-card-phone.png" });
  await context.close();
} finally {
  await browser.close();
  await cancelAll();
}
const failed = results.filter((pass) => !pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
