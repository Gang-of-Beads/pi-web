#!/usr/bin/env node
/**
 * A failed send keeps it in the outbox, shows it once, and its row acts on it alone.
 *
 * Owner reports: "a message already confirmed as being processed - how can it still have retry/discard?" and one message
 * drawn twice ("Sending" in the transcript, "Sending · Discard" above the composer). The
 * review of the one-row fix then found Retry resending the whole outbox, Retry doing nothing
 * offline, and the probe itself posting into whichever session the navigation board listed
 * first. This walks every leg against the real UI:
 *
 *   1. two sends refused at the network layer -> two rows, no tray, each row Retry + Discard
 *   2. Retry while the browser is offline -> no request, and the reader is told why
 *   3. back online, Retry on A only -> exactly A is sent; B keeps its row and its outbox entry
 *   4. Discard on B -> B's row and outbox entry are gone, and its text is back in the composer
 *
 * The prompt request is aborted at the network layer (patching window.fetch is not enough -
 * the api layer may have captured it), then reopened so Retry's own send can land.
 */

import { chromium } from "playwright";

const BASE = process.env.PI_WEB_PROBE_BASE ?? "http://127.0.0.1:8505";
const PROJECT = process.env.PI_WEB_PROBE_PROJECT ?? "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = process.env.PI_WEB_PROBE_WORKSPACE ?? "ef2cdf93e1ac";
const SESSION = process.env.PI_WEB_PROBE_SESSION ?? "01a05000-5eed-7c00-8000-0000000000c1";
const RUN = String(Date.now());
const A = `offline-probe A ${RUN}`;
const B = `offline-probe B ${RUN}`;

const fails = [];
const fail = (message) => { fails.push(message); console.log("FAIL", message); };

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 393, height: 850 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
let broken = true;
const promptRequests = [];
await page.route("**/prompt*", (route) => {
  promptRequests.push(route.request().postData() ?? "");
  return broken ? route.abort("failed") : route.continue();
});

const rows = () => page.evaluate((markers) => {
  const deepText = (node) => {
    let text = node.textContent ?? "";
    for (const child of node.querySelectorAll("*")) {
      if (child.shadowRoot) text += ` ${deepText(child.shadowRoot)}`;
    }
    return text;
  };
  const app = document.querySelector("pi-web-app");
  const view = app?.shadowRoot?.querySelector("chat-view");
  const editor = app?.shadowRoot?.querySelector("prompt-editor");
  const describe = (marker) => [...(view?.shadowRoot?.querySelectorAll(".msg.user") ?? [])]
    .filter((row) => deepText(row).includes(marker))
    .map((row) => ({
      mark: (row.querySelector(".delivery-mark")?.getAttribute("aria-label") ?? "").slice(0, 40),
      actions: [...row.querySelectorAll(".msg-action[data-action]")].map((button) => button.getAttribute("data-action")),
    }));
  const outbox = Object.keys(localStorage).filter((key) => key.includes("pending-prompt")).map((key) => localStorage.getItem(key) ?? "").join("\n");
  return {
    a: describe(markers[0]),
    b: describe(markers[1]),
    tray: [...(editor?.shadowRoot?.querySelectorAll(".pending-prompt") ?? [])].map((row) => (row.textContent ?? "").replace(/\s+/gu, " ").trim()),
    outboxA: outbox.includes(markers[0]),
    outboxB: outbox.includes(markers[1]),
    offlineNotice: deepText(document.body).includes("You are offline"),
  };
}, [A, B]);

const clickRowAction = (marker, action) => page.evaluate(([wanted, kind]) => {
  const deepText = (node) => {
    let text = node.textContent ?? "";
    for (const child of node.querySelectorAll("*")) {
      if (child.shadowRoot) text += ` ${deepText(child.shadowRoot)}`;
    }
    return text;
  };
  const view = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view");
  const matches = [...(view?.shadowRoot?.querySelectorAll(".msg.user") ?? [])].filter((row) => deepText(row).includes(wanted));
  const button = matches.length === 1 ? matches[0].querySelector(`.msg-action[data-action='${kind}']`) : null;
  button?.click();
  return button !== null && button !== undefined;
}, [marker, action]);

try {
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${SESSION}&view=chat`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);
  const selected = await page.evaluate(() => document.querySelector("pi-web-app")?.state?.selectedSession?.id ?? null);
  if (selected !== SESSION) throw new Error(`precondition: the app selected ${String(selected)}, not the probe session ${SESSION}; refusing to post into another session`);

  const sent = await page.evaluate(async (texts) => {
    const editor = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("prompt-editor");
    if (editor === null || editor === undefined) return "no composer";
    for (const text of texts) {
      Reflect.set(editor, "draft", text);
      Reflect.apply(Reflect.get(editor, "requestUpdate"), editor, []);
      await new Promise((resolve) => setTimeout(resolve, 300));
      Reflect.apply(Reflect.get(editor, "send"), editor, ["followUp"]);
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    return "ok";
  }, [A, B]);
  if (sent !== "ok") throw new Error(`precondition: ${sent}`);
  await page.waitForTimeout(6000);

  const failed = await rows();
  await page.screenshot({ path: "/tmp/offline-one-row.png" });
  console.log("1 after two refused sends:", JSON.stringify(failed));
  if (failed.a.length !== 1 || failed.b.length !== 1) fail(`expected one row each, got A=${String(failed.a.length)} B=${String(failed.b.length)}`);
  if (failed.tray.length !== 0) fail(`the composer tray repeats rows the transcript draws: ${JSON.stringify(failed.tray)}`);
  for (const [name, row] of [["A", failed.a[0]], ["B", failed.b[0]]]) {
    if (row !== undefined && !(row.actions.includes("retry") && row.actions.includes("discard"))) fail(`row ${name} does not carry Retry and Discard: ${JSON.stringify(row.actions)}`);
  }
  if (!failed.outboxA || !failed.outboxB) fail("precondition: the outbox does not hold both refused sends");

  await context.setOffline(true);
  const before = promptRequests.length;
  if (!(await clickRowAction(A, "retry"))) fail("could not find A's Retry to press offline");
  await page.waitForTimeout(1500);
  const offline = await rows();
  console.log("2 Retry while offline:", JSON.stringify({ requests: promptRequests.length - before, notice: offline.offlineNotice }));
  if (promptRequests.length !== before) fail("an offline Retry sent a request");
  if (!offline.offlineNotice) fail("an offline Retry told the reader nothing");
  await context.setOffline(false);
  await page.waitForTimeout(1500);

  broken = false;
  const beforeRetry = promptRequests.length;
  if (!(await clickRowAction(A, "retry"))) fail("could not find A's Retry to press online");
  await page.waitForTimeout(7000);
  const retried = await rows();
  const bodies = promptRequests.slice(beforeRetry);
  console.log("3 Retry on A only:", JSON.stringify({ requests: bodies.length, sentA: bodies.some((body) => body.includes(A)), sentB: bodies.some((body) => body.includes(B)), a: retried.a, b: retried.b, outboxA: retried.outboxA, outboxB: retried.outboxB }));
  if (!bodies.some((body) => body.includes(A))) fail("Retry on A did not send A");
  if (bodies.some((body) => body.includes(B))) fail("Retry on A also sent B");
  if (retried.outboxA) fail("A is still in the outbox after its Retry landed");
  if (!retried.outboxB) fail("B left the outbox although only A was retried");
  if (retried.b.length !== 1 || !retried.b[0].actions.includes("retry")) fail(`B lost its row or its Retry: ${JSON.stringify(retried.b)}`);

  if (!(await clickRowAction(B, "discard"))) fail("could not find B's Discard");
  await page.waitForTimeout(1500);
  const discarded = await rows();
  const draft = await page.evaluate(() => {
    const editor = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("prompt-editor");
    return editor === null || editor === undefined ? null : String(Reflect.get(editor, "draft") ?? "");
  });
  console.log("4 Discard on B:", JSON.stringify({ b: discarded.b, outboxB: discarded.outboxB, draftHasB: draft?.includes(B) ?? null }));
  if (discarded.b.length !== 0) fail("B's row survived its Discard");
  if (discarded.outboxB) fail("B's outbox entry survived its Discard");
  if (draft === null || !draft.includes(B)) fail(`Discard did not hand B's text back to the composer (draft: ${JSON.stringify(draft)})`);
} catch (error) {
  fail(String(error));
} finally {
  await browser.close();
}
console.log(fails.length === 0 ? "PASS offline-send: one row each; Retry is per message and honest offline; Discard clears" : `FAIL offline-send (${String(fails.length)})`);
process.exit(fails.length === 0 ? 0 : 1);
