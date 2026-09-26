import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

/**
 * An extension's own screen reaches the browser.
 *
 * `ctx.ui.custom(factory)` used to be intercepted and cancelled: pi's headless
 * host resolved the promise without running the factory, so the pi updater's
 * version prompt evaporated every session and the reader saw a notice saying a
 * screen could not be shown. The extension in ~/.pi/agent/extensions/
 * ui-custom-probe.ts draws one on session_start, so this probe can tell the
 * shapes apart: a dialog with the component's own lines, keys that redraw it, and
 * a result the extension receives.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const CWD = process.env.PROBE_CWD ?? "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";

function fail(message) {
  console.log(`FAIL ${message}`);
  process.exitCode = 1;
}

const browser = await chromium.launch();
try {
  const created = await fetch(`${BASE}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cwd: CWD }),
  }).then((response) => response.json());
  const sessionId = created.id;
  console.log("session:", sessionId);

  // Read the surface the reader sees: the daemon's own status omits empty arrays,
  // so an open dialog and a closed one look the same through it.
  // A prompt first: a session with no message yet is not in the app's lists, so a
  // URL naming it would leave the page on whatever was selected before.
  await fetch(`${BASE}/api/sessions/${sessionId}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd: CWD, text: "say ok" }) });
  await new Promise((resolve) => setTimeout(resolve, 6000));
  const page = await browser.newPage({ viewport: { width: 393, height: 850 } });
  await page.goto(`${BASE}/?project=991606fd-e498-4b93-a1ce-2af09efdb0e7&workspace=ef2cdf93e1ac&session=${sessionId}&view=chat`, { waitUntil: "domcontentloaded" });
  const screen = async () => page.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    const dialog = (app?.state?.pendingDialogs ?? []).find((candidate) => candidate.kind === "custom");
    const card = (() => { const walk = (root) => { for (const node of root.querySelectorAll("*")) { if (node.localName === "extension-dialog-card") return node; if (node.shadowRoot !== null) { const hit = walk(node.shadowRoot); if (hit !== undefined) return hit; } } return undefined; }; return walk(document); })();
    const rendered = card?.shadowRoot?.querySelector(".dialog-screen")?.textContent ?? undefined;
    return dialog === undefined ? undefined : { dialogId: dialog.dialogId, lines: dialog.lines ?? [], rendered };
  });

  let dialog;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    dialog = await screen();
    if (dialog !== undefined) break;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  if (dialog === undefined) {
    fail("no custom dialog was opened - the factory did not run (or did not mount)");
    console.log("state:", JSON.stringify(await page.evaluate(() => { const app = document.querySelector("pi-web-app"); return { dialogs: (app?.state?.pendingDialogs ?? []).length, view: app?.state?.mainView, session: app?.state?.selectedSession?.id }; })));
  } else {
    const lines = dialog.lines ?? [];
    console.log("screen:", JSON.stringify(lines));
    if (!lines.some((line) => line.includes("ui-custom probe"))) fail(`the dialog does not carry the component's lines: ${JSON.stringify(lines)}`);
    else if (dialog.rendered === undefined || !dialog.rendered.includes("ui-custom probe")) fail(`the screen is not rendered on the page: ${JSON.stringify(dialog.rendered)}`);
    else console.log("rendered:", JSON.stringify(dialog.rendered.slice(0, 90)));

    const sendKey = (key) => fetch(`${BASE}/api/sessions/${sessionId}/dialog/key`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: CWD, dialogId: dialog.dialogId, key }),
    }).then((response) => response.json());

    const delivered = await sendKey("a");
    await new Promise((resolve) => setTimeout(resolve, 800));
    const redrawn = await screen();
    console.log("after a key:", JSON.stringify(redrawn?.lines ?? null), "· delivered:", JSON.stringify(delivered));
    if (redrawn === undefined) fail("the screen closed on a key it should have counted");
    else if (!(redrawn.lines ?? []).some((line) => line.includes("keys pressed: 1"))) fail("the key did not reach the component (no redraw)");

    const logPath = process.env.PROBE_DAEMON_LOG ?? `${process.env.HOME}/.pi-web-8505/logs/sessiond.log`;
    const countReturns = () => { try { return (readFileSync(logPath, "utf8").match(/ui-custom-probe\] returned/gu) ?? []).length; } catch { return 0; } };
    const before = countReturns();
    const escape = await sendKey("escape");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const gone = await screen();
    // The proof is the extension resuming after its own screen, which the probe
    // extension writes to stderr (the stack's daemon log). Its ctx.ui.notify rides
    // a command.output event into the notification store rather than the transcript,
    // so the log is the readable evidence.
    let returned = false;
    for (let attempt = 0; attempt < 8 && !returned; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      returned = countReturns() > before;
    }
    console.log("after escape:", JSON.stringify(escape), "· dialog gone:", gone === undefined, "· result reached the extension:", returned);
    if (gone !== undefined) fail("Escape did not close the screen");
    else if (!returned) {
      const tail = await fetch(`${BASE}/api/sessions/${sessionId}/messages?cwd=${encodeURIComponent(CWD)}`).then((response) => response.json()).catch(() => ({}));
      const status = await fetch(`${BASE}/api/sessions/${sessionId}/status?cwd=${encodeURIComponent(CWD)}`).then((response) => response.json()).catch(() => ({}));
      console.log("tail:", JSON.stringify((tail.messages ?? []).slice(-3)).slice(0, 400));
      console.log("activity:", JSON.stringify(status.activity ?? null).slice(0, 200), "warnings:", JSON.stringify(status.warnings ?? null).slice(0, 200));
      console.log("log:", logPath, "counts", before, "->", countReturns());
      fail("the extension never received the result of its own screen");
    }
    else console.log("PASS an extension screen renders, takes keys, and returns a result");
  }
} finally {
  await browser.close();
}
