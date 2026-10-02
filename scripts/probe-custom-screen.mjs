import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

/**
 * An extension's own screen reaches the browser.
 *
 * `ctx.ui.custom(factory)` used to be intercepted and cancelled: pi's headless
 * host resolved the promise without running the factory, so the pi updater's
 * version prompt evaporated every session and the reader saw a notice saying a
 * screen could not be shown. The extension in ~/.pi/agent/extensions/
 * ui-custom-probe.ts draws one when this probe sends `/ui-custom-probe`, so it can
 * tell the shapes apart: a dialog with the component's own lines, keys that redraw
 * it, and a result the extension receives.
 *
 * Its screen reads as a menu, so it wears the select card (state-diagram D2, slice
 * a): the component's first line as the heading, the options as option buttons, no
 * key row, and a tap that walks the cursor and selects.
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
  const selected = await fetch(`${BASE}/api/sessions/${sessionId}/model`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd: CWD, provider: "pi-web-probe", modelId: "flaky" }) }).then((r) => r.json());
  if (selected?.model?.provider !== "pi-web-probe") throw new Error("the zero-cost fixture model is not selectable; this probe never prompts the machine's default model");
  // A prompt first: a session with no message yet is not in the app's lists, so a
  // URL naming it would leave the page on whatever was selected before.
  await fetch(`${BASE}/api/sessions/${sessionId}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd: CWD, text: "say ok" }) });
  await new Promise((resolve) => setTimeout(resolve, 6000));
  // The warm-up run retries against a fixture model nobody serves; a screen opened while it
  // still runs is settled with that run, so the command waits for the session to be idle.
  for (let waited = 0; waited < 120_000; waited += 1000) {
    const status = await fetch(`${BASE}/api/sessions/${sessionId}/status?cwd=${encodeURIComponent(CWD)}`).then((response) => response.json()).catch(() => ({}));
    if (status.isStreaming === false && status.activity?.status !== "active") break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await fetch(`${BASE}/api/sessions/${sessionId}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd: CWD, text: "/ui-custom-probe" }) });
  const page = await browser.newPage({ viewport: { width: 393, height: 850 } });
  await page.goto(`${BASE}/?project=991606fd-e498-4b93-a1ce-2af09efdb0e7&workspace=ef2cdf93e1ac&session=${sessionId}&view=chat`, { waitUntil: "domcontentloaded" });
  const screen = async () => page.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    // The state may hold either the dialogs or rows wrapping them; assume neither.
    const dialog = (app?.state?.pendingDialogs ?? [])
      .map((candidate) => candidate.dialog ?? candidate)
      .find((candidate) => candidate.kind === "custom");
    const card = (() => { const walk = (root) => { for (const node of root.querySelectorAll("*")) { if (node.localName === "extension-dialog-card") return node; if (node.shadowRoot !== null) { const hit = walk(node.shadowRoot); if (hit !== undefined) return hit; } } return undefined; }; return walk(document); })();
    const options = card?.shadowRoot?.querySelector(".dialog-options");
    const rendered = options === null || options === undefined
      ? card?.shadowRoot?.querySelector(".dialog-screen")?.textContent ?? undefined
      : `${card?.shadowRoot?.querySelector("h2")?.textContent ?? ""} | ${options.textContent ?? ""}`;
    return dialog === undefined ? undefined : { dialogId: dialog.dialogId, lines: dialog.lines ?? [], rendered };
  });

  let dialog;
  // A cold session takes tens of seconds to reach `session_start` (model catalog
  // first), and the screen opens from there.
  for (let attempt = 0; attempt < 200; attempt += 1) {
    dialog = await screen();
    if (dialog !== undefined) break;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  if (dialog === undefined) {
    fail("no custom dialog was opened - the factory did not run (or did not mount)");
    console.log("state:", JSON.stringify(await page.evaluate(() => { const app = document.querySelector("pi-web-app"); const pendingNow = app?.state?.pendingDialogs ?? []; const firstNow = (pendingNow[0]?.dialog ?? pendingNow[0]) ?? null; const walkNow = (root) => { for (const node of root.querySelectorAll("*")) { if (node.localName === "extension-dialog-card") return node; if (node.shadowRoot !== null) { const found = walkNow(node.shadowRoot); if (found !== undefined) return found; } } return undefined; }; return { firstKind: firstNow?.kind ?? null, firstKeys: firstNow === null ? [] : Object.keys(firstNow).slice(0, 12), card: walkNow(app?.shadowRoot ?? document) !== undefined, dialogs: (app?.state?.pendingDialogs ?? []).length, view: app?.state?.mainView, session: app?.state?.selectedSession?.id }; })));
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

    const delivered = await sendKey("down");
    await new Promise((resolve) => setTimeout(resolve, 900));
    const redrawn = await screen();
    console.log("after a key:", JSON.stringify((redrawn?.lines ?? []).find((line) => line.includes("\u25b8")) ?? null), "· delivered:", JSON.stringify(delivered));
    if (redrawn === undefined) fail("the screen closed on a key it should have handled");
    else if (!(redrawn.lines ?? []).some((line) => line.includes("\u25b8 second"))) fail("the forwarded key did not reach the component (no redraw)");

    const logPath = process.env.PROBE_DAEMON_LOG ?? `${process.env.HOME}/.pi-web-8505/logs/sessiond.log`;
    const countReturns = () => { try { return (readFileSync(logPath, "utf8").match(/ui-custom-probe\] returned/gu) ?? []).length; } catch { return 0; } };
    const beforeTap = countReturns();
    // Touch path, in the order a phone would use it: the key row first (a screen
    // whose choice is not a cursor needs it), then a tap on a line, which must
    // walk the component's cursor there and select it.
    const card = await page.evaluate(() => {
      const find = (root) => { for (const n of root.querySelectorAll("*")) { if (n.localName === "extension-dialog-card") return n; if (n.shadowRoot !== null) { const hit = find(n.shadowRoot); if (hit !== undefined) return hit; } } return undefined; };
      const root = find(document)?.shadowRoot;
      return {
        heading: root?.querySelector("h2")?.textContent?.trim() ?? null,
        options: [...(root?.querySelectorAll(".dialog-options .option-button") ?? [])].map((node) => node.textContent.trim()),
        current: root?.querySelector(".option-button.current")?.textContent?.trim() ?? null,
        keyRow: root?.querySelectorAll(".dialog-screen-keys").length ?? -1,
        footer: [...(root?.querySelectorAll(".dialog-footer button") ?? [])].map((node) => node.textContent.trim()),
      };
    });
    console.log("card:", JSON.stringify(card));
    if (card.heading === null || !card.heading.includes("ui-custom probe")) fail(`the card is not headed by the screen's own first line: ${JSON.stringify(card.heading)}`);
    if (JSON.stringify(card.options) !== JSON.stringify(["first", "second", "third"])) fail(`the menu is not the select card's option buttons: ${JSON.stringify(card.options)}`);
    if (card.current !== "second") fail(`the component's cursor is not marked on its option: ${JSON.stringify(card.current)}`);
    if (card.keyRow !== 0) fail("a screen that reads as a menu still draws the key row");
    if (JSON.stringify(card.footer) !== JSON.stringify(["Cancel"])) fail(`the card's close control is not Cancel: ${JSON.stringify(card.footer)}`);

    const readLog = () => { try { return readFileSync(logPath, "utf8"); } catch { return ""; } };
    const tapped = await page.evaluate(() => {
      const find = (root) => { for (const n of root.querySelectorAll("*")) { if (n.localName === "extension-dialog-card") return n; if (n.shadowRoot !== null) { const hit = find(n.shadowRoot); if (hit !== undefined) return hit; } } return undefined; };
      const rows = [
        ...(find(document)?.shadowRoot?.querySelectorAll(".option-button, .screen-line") ?? []),
      ];
      const row = rows.find((node) => (node.textContent ?? "").includes("third"));
      if (row === undefined) return "no row";
      row.click();
      return "tapped third";
    });
    console.log("tap:", tapped);
    let selected = false;
    for (let attempt = 0; attempt < 10 && !selected; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      selected = countReturns() > beforeTap && readLog().includes("returned third");
    }
    if (tapped === "no row") fail("the screen drew no tappable rows");
    else if (!selected) fail(`tapping a line did not select it (log: ${readLog().split("ui-custom-probe] returned").slice(-1)[0]?.slice(0, 40)})`);
    else console.log("tapping a line walked the cursor there and selected it");

    const escape = await sendKey("escape");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const gone = await screen();
    // The proof is the extension resuming after its own screen, which the probe
    // extension writes to stderr (the stack's daemon log). Its ctx.ui.notify rides
    // a command.output event into the notification store rather than the transcript,
    // so the log is the readable evidence.
    const beforeEscape = countReturns();
    let returned = false;
    for (let attempt = 0; attempt < 8 && !returned; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      returned = countReturns() > beforeEscape;
    }
    console.log("after escape:", JSON.stringify(escape), "· dialog gone:", gone === undefined, "· result reached the extension:", returned);
    // The tap already selected and closed the dialog, so the Escape phase is the
    // informational one in that run; it is the assertion when the tap did nothing.
    if (tapped === "tapped third") console.log("note: the dialog was already closed by the tap; Escape is informational here");
    else if (gone !== undefined) fail("Escape did not close the screen");
    else if (!returned) {
      const tail = await fetch(`${BASE}/api/sessions/${sessionId}/messages?cwd=${encodeURIComponent(CWD)}`).then((response) => response.json()).catch(() => ({}));
      const status = await fetch(`${BASE}/api/sessions/${sessionId}/status?cwd=${encodeURIComponent(CWD)}`).then((response) => response.json()).catch(() => ({}));
      console.log("tail:", JSON.stringify((tail.messages ?? []).slice(-3)).slice(0, 400));
      console.log("activity:", JSON.stringify(status.activity ?? null).slice(0, 200), "warnings:", JSON.stringify(status.warnings ?? null).slice(0, 200));
      console.log("log:", logPath, "counts", beforeEscape, "->", countReturns());
      fail("the extension never received the result of its own screen");
    }
    else console.log("PASS an extension screen renders, takes keys, and returns a result");
  }
} finally {
  await browser.close();
}
