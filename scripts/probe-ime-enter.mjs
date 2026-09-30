import { createServer } from "node:http";
import { chromium } from "@playwright/test";

/**
 * Enter that confirms an input-method candidate does not send the message.
 *
 * User report (2026-09-30): with a Chinese IME on desktop, every Enter that picked a word
 * sent the message. Some browsers deliver that Enter just after `compositionend`, without
 * `isComposing` but with `keyCode` 229. This probe sends exactly that key to the real
 * composer through Chromium's input pipeline (CDP, windowsVirtualKeyCode 229), then a
 * plain Enter as the control. It serves the `pi-web-probe/flaky` model that
 * ~/.pi/agent/extensions/ui-custom-probe.ts registers on 8505, so a send reaches a
 * provider this probe can see.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const CWD = process.env.PROBE_CWD ?? "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";
const PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = "ef2cdf93e1ac";
const WORD = "你好世界";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
function leg(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` - ${detail}`}`);
}

const requests = [];
const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    requests.push(body);
    response.writeHead(200, { "content-type": "text/event-stream" });
    const chunk = (delta, finish) => `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "flaky", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    response.write(chunk({ role: "assistant", content: "ime probe reply" }, null));
    response.write(chunk({}, "stop"));
    response.end("data: [DONE]\n\n");
  });
});
await new Promise((resolve) => server.listen(18999, "127.0.0.1", resolve));

const api = (path, init) => fetch(`${BASE}/api/${path}`, { headers: { "content-type": "application/json" }, ...init }).then((response) => response.json());
const created = await api("sessions", { method: "POST", body: JSON.stringify({ cwd: CWD }) });
const sessionId = created.id;
if (typeof sessionId !== "string") throw new Error(`no session: ${JSON.stringify(created)}`);
const selected = await api(`sessions/${sessionId}/model`, { method: "POST", body: JSON.stringify({ cwd: CWD, provider: "pi-web-probe", modelId: "flaky" }) });
if (selected?.model?.provider !== "pi-web-probe") throw new Error(`the probe model is not selectable (is the fixture loaded?): ${JSON.stringify(selected).slice(0, 300)}`);
const sentWord = () => requests.some((body) => body.includes(WORD));

await api(`sessions/${sessionId}/prompt`, { method: "POST", body: JSON.stringify({ cwd: CWD, text: "warm up" }) });
for (let attempt = 0; attempt < 60; attempt += 1) {
  await sleep(1000);
  const status = await api(`sessions/${sessionId}/status?cwd=${encodeURIComponent(CWD)}`);
  if (status.isStreaming !== true && requests.length > 0) break;
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${sessionId}&view=chat`, { waitUntil: "domcontentloaded" });
  const composerText = () => page.evaluate(() => {
    const walk = (root) => { for (const child of root.querySelectorAll("*")) { if (child.classList?.contains("cm-content")) return child; if (child.shadowRoot) { const hit = walk(child.shadowRoot); if (hit) return hit; } } return undefined; };
    return walk(document)?.textContent ?? null;
  });
  const focusComposer = () => page.evaluate(() => {
    const walk = (root) => { for (const child of root.querySelectorAll("*")) { if (child.classList?.contains("cm-content")) return child; if (child.shadowRoot) { const hit = walk(child.shadowRoot); if (hit) return hit; } } return undefined; };
    const content = walk(document);
    content?.focus();
    return content !== undefined;
  });
  let ready = false;
  for (let attempt = 0; attempt < 40 && !ready; attempt += 1) {
    const onSession = await page.evaluate(() => document.querySelector("pi-web-app")?.state?.selectedSession?.id);
    ready = onSession === sessionId && (await composerText()) !== null;
    if (!ready) await sleep(500);
  }
  leg("precondition: the page is on the probe session with a composer", ready);
  if (!ready) throw new Error("no composer on the probe session; every other leg would be vacuous");

  await focusComposer();
  await page.keyboard.insertText(WORD);
  leg("precondition: the word is in the composer", (await composerText()) === WORD, JSON.stringify(await composerText()));

  const cdp = await page.context().newCDPSession(page);
  const enter = async (keyCode) => {
    await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  };

  await enter(229);
  await sleep(2500);
  leg("Enter that confirms a candidate (keyCode 229) sends nothing", !sentWord(), `provider requests with the word: ${String(requests.filter((body) => body.includes(WORD)).length)}`);
  leg("the word stays in the composer", (await composerText()) === WORD, JSON.stringify(await composerText()));

  await focusComposer();
  await enter(13);
  for (let attempt = 0; attempt < 20 && !sentWord(); attempt += 1) await sleep(500);
  leg("control: a plain Enter sends the word", sentWord());
  await page.screenshot({ path: "/tmp/journeys/ime-enter.png" });
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? `ALL ${String(results.length)} LEGS PASS` : `${String(failed)} of ${String(results.length)} LEGS FAILED`);
process.exitCode = failed === 0 ? 0 : 1;
