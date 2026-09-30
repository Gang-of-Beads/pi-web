import { chromium } from "@playwright/test";

/**
 * The app row says why a read goes unanswered (B48, owner Q9, object model
 * §2.3, P1 slice 4).
 *
 * Before: every miss read "Reconnecting…", including a server that answered
 * with an error. Owner Q9: a server error shows its reason, never
 * "reconnecting". Now the row names the machine and keeps the server's own
 * words.
 *
 * Phone 393x850, coarse pointer. The selected machine's projects read is
 * intercepted for 6 s from the first request:
 * - A: answered 500 {"error": "Project store is locked"}. Expect the row to
 *   read "Local: Project store is locked" once, never "Reconnecting…", and to
 *   leave when the answers flow again.
 * - B, control: the connection is reset. Expect "Reconnecting…" once, and the
 *   row to leave.
 * The row is the transient status line without a dismiss control; a notice
 * always has one, so it is never counted as the row.
 */
const BASE = process.env.PI_WEB_PROBE_BASE ?? process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const PROJECTS_READ = /\/api\/machines\/local\/projects$/u;
const REASON = "Project store is locked";
const LOSS_MS = 6000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
function leg(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` - ${detail}`}`);
}

async function watchRow(page, failure) {
  let failed = 0;
  let answered = 0;
  let lossUntil;
  await page.route(PROJECTS_READ, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    lossUntil ??= Date.now() + LOSS_MS;
    if (Date.now() < lossUntil) {
      failed += 1;
      return failure(route);
    }
    answered += 1;
    return route.continue();
  });
  await page.goto(`${BASE}/?view=sessions`, { waitUntil: "domcontentloaded" });
  const rowTexts = [];
  let mounts = 0;
  let shown = false;
  let lastShownAt;
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    const text = await page.evaluate(() => {
      const deep = (root) => [...root.querySelectorAll("*")].flatMap((element) => [
        ...(element.matches(".error.transient[role=status]:not(:has(.error-dismiss)) .error-text") ? [element.textContent?.trim() ?? ""] : []),
        ...(element.shadowRoot ? deep(element.shadowRoot) : []),
      ]);
      return deep(document)[0];
    });
    const showing = text !== undefined;
    if (showing && !shown) mounts += 1;
    if (showing && !rowTexts.includes(text)) rowTexts.push(text);
    if (showing) lastShownAt = Date.now();
    shown = showing;
    if (answered > 0 && !showing && lastShownAt !== undefined && Date.now() - lastShownAt > 2000) break;
    await sleep(150);
  }
  await page.unroute(PROJECTS_READ);
  return { failed, answered, rowTexts, mounts, stillShown: shown };
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));

  const a = await watchRow(await context.newPage(), (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: REASON }) }));
  leg("precondition A: the projects read answered 500 for 6 s, then answered", a.failed >= 3 && a.answered >= 1, `failed ${String(a.failed)}, answered ${String(a.answered)}`);
  leg("A: the row shows the server's reason, naming the machine", a.rowTexts.includes(`Local: ${REASON}`), JSON.stringify(a.rowTexts));
  leg("A: the row never says Reconnecting for a server error", !a.rowTexts.some((text) => text.includes("Reconnecting")), JSON.stringify(a.rowTexts));
  leg("A: the row shows once, and leaves when answers flow", a.mounts === 1 && !a.stillShown, `mounts ${String(a.mounts)}, still shown ${String(a.stillShown)}`);

  const b = await watchRow(await context.newPage(), (route) => route.abort("connectionreset"));
  leg("precondition B: the projects read was lost for 6 s, then answered", b.failed >= 3 && b.answered >= 1, `failed ${String(b.failed)}, answered ${String(b.answered)}`);
  leg("B: a lost connection reads Reconnecting…, once, and leaves", JSON.stringify(b.rowTexts) === JSON.stringify(["Reconnecting…"]) && b.mounts === 1 && !b.stillShown, `${JSON.stringify(b.rowTexts)}, mounts ${String(b.mounts)}`);
} finally {
  await browser.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${String(results.length - failed)}/${String(results.length)} legs passed`);
process.exit(failed === 0 ? 0 : 1);
