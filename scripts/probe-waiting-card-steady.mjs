#!/usr/bin/env node
/**
 * Live check at 393x850 coarse: while a turn streams above them, the cards in
 * the waiting slot must not rebuild. A rebuilt form loses what was typed and
 * moves a control under a finger, which is the shake reported from the device.
 *
 * The status frames are replayed against the live components rather than
 * waiting for a model, so the probe fails on a missing card instead of passing
 * an empty screen.
 */
import { chromium } from "playwright";

const BASE = process.env.PI_WEB_PROBE_BASE ?? "http://127.0.0.1:8505";

function fail(message) { console.error(`FAIL: ${message}`); process.exit(1); }

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true })).newPage();
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("pi-web-app");
await page.waitForTimeout(2500);

const result = await page.evaluate(async () => {
  const ask = () => ({
    askId: "ask-steady",
    id: "ask-steady",
    questions: [{ id: "q1", question: "Which one?", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }],
    askedAt: new Date(0).toISOString(),
  });
  const dialog = () => ({ dialogId: "dlg-steady", kind: "confirm", title: "Update now?", options: ["Yes", "No"], askedAt: new Date(0).toISOString() });

  const card = document.createElement("ask-user-card");
  const dlg = document.createElement("extension-dialog-card");
  card.ask = ask();
  dlg.dialog = dialog();
  document.body.append(card, dlg);
  await card.updateComplete;
  await dlg.updateComplete;

  const renders = { ask: 0, dialog: 0 };
  const count = (element, key) => {
    const proto = Object.getPrototypeOf(element);
    const original = proto.update;
    element.update = function patched(changed) { renders[key] += 1; return original.call(this, changed); };
  };
  count(card, "ask");
  count(dlg, "dialog");

  const firstControl = card.shadowRoot?.querySelector("button, input");
  if (firstControl === null || firstControl === undefined) return { error: "the ask card rendered no control, so this probe proves nothing" };
  if ((dlg.shadowRoot?.querySelector("button, input") ?? null) === null) return { error: "the dialog card rendered no control, so this probe proves nothing" };

  for (let frame = 0; frame < 20; frame += 1) {
    card.ask = ask();
    dlg.dialog = dialog();
    await card.updateComplete;
    await dlg.updateComplete;
  }

  const changed = { ...renders };
  card.ask = { ...ask(), questions: [{ id: "q1", question: "Which one now?", options: [{ value: "a", label: "A" }] }] };
  dlg.dialog = { ...dialog(), title: "Update later?" };
  await card.updateComplete;
  await dlg.updateComplete;
  const afterRealChange = { ask: renders.ask - changed.ask, dialog: renders.dialog - changed.dialog };

  card.remove();
  dlg.remove();
  return { repeatedFrameRenders: renders, afterRealChange };
});

await browser.close();

if (result.error !== undefined) fail(result.error);
console.log(JSON.stringify(result, null, 2));
// A card may settle once on its own internal state (a countdown, a step
// guard). Twenty repeated frames must not each cost a render.
const SETTLING_RENDERS = 1;
if (result.repeatedFrameRenders.ask > SETTLING_RENDERS) fail(`the ask card re-rendered ${String(result.repeatedFrameRenders.ask)} times on 20 identical status frames`);
if (result.repeatedFrameRenders.dialog > SETTLING_RENDERS) fail(`the extension dialog card re-rendered ${String(result.repeatedFrameRenders.dialog)} times on 20 identical status frames`);
if (result.afterRealChange.ask === 0 || result.afterRealChange.dialog === 0) fail("a real change to the question did not re-render the card, which would freeze a stale question on screen");
console.log("PASS: the waiting-slot cards ignore repeated status frames and still follow a real change");
