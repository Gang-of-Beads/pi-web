import { chromium } from "@playwright/test";

/**
 * A card's scroll region chains to the transcript at its end (state-diagram D2, B11), 8505,
 * phone 393x850.
 *
 * The owner reported that the wheel over a card scrolled nothing. A dialog's detail region declared
 * `overscroll-behavior: contain`, so a wheel or swipe that reached the region's end stopped there
 * instead of moving the conversation; D2 keeps `contain` for overlays. The fixture command
 * `/long-confirm-probe` opens a confirm whose message overflows its card. With the detail at its
 * top, a wheel up over it must scroll the transcript up; a wheel over the transcript itself is
 * the control. No session is created and nothing is prompted.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const CWD = `${process.env.HOME}/.pi-web-8505/pi-web-8505-seed-workspace`;
const PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = "ef2cdf93e1ac";
const SESSION = process.env.PROBE_SESSION ?? "01a05000-5eed-7c00-8000-0000000000c1";
const results = [];
const check = (name, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` (${detail})`}`);
};
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const post = (path, body) => fetch(`${BASE}/api/sessions/${SESSION}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd: CWD, ...body }) });
const pendingDialogs = async () => (await fetch(`${BASE}/api/sessions/${SESSION}/status?cwd=${encodeURIComponent(CWD)}`).then((response) => response.json())).pendingDialogs ?? [];
const cancelAll = async () => { for (const dialog of await pendingDialogs()) await post("dialogs/cancel", { dialogId: dialog.dialogId }); };

const geometry = (page) => page.evaluate(() => {
  const all = (root, selector) => [...root.querySelectorAll(selector), ...[...root.querySelectorAll("*")].flatMap((node) => (node.shadowRoot === null ? [] : all(node.shadowRoot, selector)))];
  const chat = all(document, "chat-view").map((view) => view.shadowRoot?.querySelector(".chat")).find((element) => element !== null && element !== undefined);
  const detail = all(document, "extension-dialog-card").map((card) => card.shadowRoot?.querySelector(".dialog-detail")).find((element) => element !== null && element !== undefined && element.getBoundingClientRect().height > 0);
  const box = detail?.getBoundingClientRect();
  const chatBox = chat?.getBoundingClientRect();
  const row = chatBox === undefined ? null : { x: chatBox.x + chatBox.width / 2, y: chatBox.y + 120 };
  const rowInside = row !== null && box !== undefined && row.y < box.top;
  const visibleTop = box === undefined || chatBox === undefined ? 0 : Math.max(box.top, chatBox.top);
  const visibleBottom = box === undefined || chatBox === undefined ? 0 : Math.min(box.bottom, chatBox.bottom);
  const aim = box === undefined ? undefined : { x: box.x + box.width / 2, y: visibleTop + Math.min(40, (visibleBottom - visibleTop) / 2) };
  const deepest = (x, y) => {
    let node = document.elementFromPoint(x, y);
    while (node?.shadowRoot) {
      const inner = node.shadowRoot.elementFromPoint(x, y);
      if (inner === null || inner === node) break;
      node = inner;
    }
    return node;
  };
  const hit = aim === undefined ? null : deepest(aim.x, aim.y);
  return {
    chatTop: chat?.scrollTop ?? null,
    chatRange: chat === undefined ? null : chat.scrollHeight - chat.clientHeight,
    detail: box === undefined || aim === undefined ? null : { x: aim.x, y: aim.y, onDetail: hit !== null && detail.contains(hit), visible: visibleBottom - visibleTop, top: detail.scrollTop, overflow: detail.scrollHeight - detail.clientHeight },
    row: rowInside ? row : null,
  };
});

await cancelAll();
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${SESSION}&view=chat`);
  await page.waitForTimeout(8000);
  await cancelAll();
  await page.waitForTimeout(1500);
  void post("commands/run", { text: "/long-confirm-probe" }).catch(() => undefined);
  const card = page.locator("extension-dialog-card .dialog-detail");
  const opened = await card.first().waitFor({ state: "visible", timeout: 20_000 }).then(() => true, () => false);
  check("precondition: /long-confirm-probe opens a card with a detail region", opened);
  if (!opened) throw new Error("no card opened");
  await page.waitForTimeout(1500);

  const start = await geometry(page);
  check("precondition: the detail overflows and sits at its top", start.detail !== null && start.detail.overflow > 0 && start.detail.top === 0, JSON.stringify(start.detail));
  check("precondition: the wheel point lands on the detail, inside the transcript's view", start.detail?.onDetail === true && start.detail.visible > 20, JSON.stringify(start.detail));
  check("precondition: the transcript can scroll up", start.chatTop !== null && start.chatTop > 200 && start.row !== null, JSON.stringify({ chatTop: start.chatTop, range: start.chatRange, row: start.row }));

  await page.mouse.move(start.row.x, start.row.y);
  await page.mouse.wheel(0, -120);
  await sleep(800);
  const afterControl = await geometry(page);
  check("control: a wheel up over the transcript scrolls it up", afterControl.chatTop !== null && afterControl.chatTop < start.chatTop, `${String(start.chatTop)} -> ${String(afterControl.chatTop)}`);

  await page.mouse.move(afterControl.detail.x, afterControl.detail.y);
  await page.mouse.wheel(0, -120);
  await sleep(800);
  const afterCard = await geometry(page);
  check("a wheel up over the card's detail at its top scrolls the transcript up", afterCard.detail?.top === 0 && afterCard.chatTop !== null && afterCard.chatTop < afterControl.chatTop, `${String(afterControl.chatTop)} -> ${String(afterCard.chatTop)}, detail top ${String(afterCard.detail?.top)}`);
  await page.screenshot({ path: "/tmp/surfaces/card-wheel-chains-phone.png" });
  await context.close();
} finally {
  await browser.close();
  await cancelAll();
}
const failed = results.filter((pass) => !pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
