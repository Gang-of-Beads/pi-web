import { createServer } from "node:http";
import { chromium } from "@playwright/test";

/**
 * One message, one row, one state, one time, on every page (D1; B1, B3, B5, B6), 8505, phone 393x850.
 *
 * Owner reports: "Queued · 2" drawn above "Queued · 1" (B1); a message already read still saying
 * "Queued" (B3); a message's time changing when the agent reads it (B5: 12:23:49/50/51 all became
 * 12:24:04); a message drawn twice, and a second page showing queued messages as already read (B6).
 * Page A sends three messages through its composer while a long reply streams; page B watches the
 * same session. Both are sampled every 250 ms until the session settles.
 * Legs:
 * - precondition: the long reply streams while the three are sent, and page A shows all three;
 * - B1: wherever the three are drawn, on either page, they are in the order sent;
 * - B3: once a message is drawn as read, no later sample draws it as queued, on either page;
 * - B5: each message keeps the time it was first shown with, on both pages, after it is read, and
 *   both pages show it with the same time;
 * - B6: each message is drawn once per page in every sample, and page B ends with the same rows;
 * - nothing is left queued once the session settles.
 * Serves the `pi-web-probe/flaky` model on 18999 (no real model is prompted) and archives its
 * session at the end.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = "ef2cdf93e1ac";
const CWD = "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";
const MARK = `rows-${String(Date.now()).slice(-6)}`;
const SENT = ["one", "two", "three"].map((word) => `${MARK} ${word}`);
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const results = [];
const check = (name, pass, detail) => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` (${detail})`}`);
};

const textOf = (content) => (typeof content === "string" ? content : Array.isArray(content) ? content.map((part) => part?.text ?? "").join("") : "");
const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", async () => {
    const chunk = (delta, finish) => `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "flaky", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    const messages = JSON.parse(body).messages ?? [];
    const lastReply = messages.map((message) => message.role).lastIndexOf("assistant");
    const fresh = messages.slice(lastReply + 1).filter((message) => message.role === "user").map((message) => textOf(message.content));
    const last = fresh.at(-1) ?? "";
    response.writeHead(200, { "content-type": "text/event-stream" });
    if (!last.includes("probe-long")) {
      response.write(chunk({ role: "assistant", content: last.startsWith(MARK) ? "answered the three" : "probe warm reply" }, null));
      response.write(chunk({}, "stop"));
      response.end("data: [DONE]\n\n");
      return;
    }
    let closed = false;
    response.on("close", () => { closed = true; });
    response.write(chunk({ role: "assistant", content: "" }, null));
    for (let tick = 1; tick <= 25 && !closed; tick += 1) {
      response.write(chunk({ content: `tick ${String(tick)}. ` }, null));
      await sleep(400);
    }
    if (closed) return;
    response.write(chunk({}, "stop"));
    response.end("data: [DONE]\n\n");
  });
});
await new Promise((resolve) => { server.listen(18999, "127.0.0.1", resolve); });

const api = (path, init) => fetch(`${BASE}/api/${path}`, { headers: { "content-type": "application/json" }, ...init }).then((response) => response.json());

const sample = (page) => page.evaluate((mark) => {
  const deep = (root, selector) => [...root.querySelectorAll(selector), ...[...root.querySelectorAll("*")].flatMap((element) => (element.shadowRoot ? deep(element.shadowRoot, selector) : []))];
  const deepText = (node) => [...node.childNodes].map((child) => (child.nodeType === 3 ? child.textContent : child.shadowRoot ? deepText(child.shadowRoot) + deepText(child) : deepText(child))).join("");
  const rows = deep(document, "chat-view").flatMap((view) => [...(view.shadowRoot?.querySelectorAll(".msg.user") ?? [])])
    .filter((row) => deepText(row).includes(mark) && row.checkVisibility())
    .map((row) => {
      const word = new RegExp(`${mark} (one|two|three)`, "u").exec(deepText(row))?.[1] ?? "?";
      return { word, queued: row.classList.contains("queued"), label: row.querySelector(".msg-header .label")?.textContent?.trim() ?? "" };
    });
  const app = document.querySelector("pi-web-app");
  const times = {};
  for (const line of app?.state?.messages ?? []) {
    const text = JSON.stringify(line.parts ?? line.content ?? "");
    const word = text.includes(mark) ? new RegExp(`${mark} (one|two|three)`, "u").exec(text)?.[1] : undefined;
    if (word !== undefined) times[word] = line.meta?.timestamp ?? null;
  }
  return { at: Date.now(), rows, times };
}, MARK);

let sessionId;
const browser = await chromium.launch();
try {
  const created = await api("sessions", { method: "POST", body: JSON.stringify({ cwd: CWD }) });
  sessionId = created.id;
  if (typeof sessionId !== "string") throw new Error(`no session: ${JSON.stringify(created)}`);
  const selected = await api(`sessions/${sessionId}/model`, { method: "POST", body: JSON.stringify({ cwd: CWD, provider: "pi-web-probe", modelId: "flaky" }) });
  if (selected?.model?.provider !== "pi-web-probe") throw new Error(`the probe model is not selectable: ${JSON.stringify(selected).slice(0, 200)}`);
  await api(`sessions/${sessionId}/prompt`, { method: "POST", body: JSON.stringify({ cwd: CWD, text: "warm up" }) });
  const status = () => api(`sessions/${sessionId}/status?cwd=${encodeURIComponent(CWD)}`).catch(() => undefined);
  for (let waited = 0; waited < 40_000; waited += 500) {
    const snapshot = await status();
    if (snapshot !== undefined && snapshot.isStreaming !== true && waited > 2_000) break;
    await sleep(500);
  }

  const link = `${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${sessionId}&view=chat`;
  const open = async () => {
    const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
    await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
    const page = await context.newPage();
    await page.goto(link);
    await page.waitForTimeout(5_000);
    return page;
  };
  const pageA = await open();
  const pageB = await open();
  const send = async (text) => {
    await pageA.locator("prompt-editor .cm-content").first().click({ timeout: 5_000 });
    await pageA.keyboard.type(text);
    await pageA.locator("prompt-editor button.send-button").first().click({ timeout: 5_000 });
  };

  await send("probe-long: count");
  await sleep(3_000);
  for (const text of SENT) {
    await send(text);
    await sleep(400);
  }

  const samplesA = [];
  const samplesB = [];
  const started = Date.now();
  let settledAt;
  while (Date.now() - started < 150_000) {
    samplesA.push(await sample(pageA));
    samplesB.push(await sample(pageB));
    const snapshot = await status();
    const done = snapshot !== undefined && snapshot.isStreaming !== true && (snapshot.queuedMessages ?? []).length === 0
      && samplesA.at(-1).rows.length === 3 && samplesA.at(-1).rows.every((row) => !row.queued);
    if (done) {
      settledAt ??= Date.now();
      if (Date.now() - settledAt > 3_000) break;
    } else {
      settledAt = undefined;
    }
    await sleep(250);
  }

  const shownAll = samplesA.find((entry) => entry.rows.length === 3);
  check("precondition: page A shows all three while the reply streams", shownAll !== undefined, JSON.stringify(samplesA.slice(0, 4).map((entry) => entry.rows)));
  const shownAllOnB = samplesB.find((entry) => entry.rows.length === 3);
  check("precondition: page B shows all three as well", shownAllOnB !== undefined, JSON.stringify(samplesB.slice(0, 4).map((entry) => entry.rows)));
  const wordsOrder = ["one", "two", "three"];
  const inOrder = (entry) => {
    const words = entry.rows.map((row) => row.word);
    const positions = words.map((word) => wordsOrder.indexOf(word));
    return positions.every((position, index) => index === 0 || position > positions[index - 1]);
  };
  for (const [name, samples] of [["A", samplesA], ["B", samplesB]]) {
    const outOfOrder = samples.filter((entry) => !inOrder(entry));
    check(`B1 page ${name}: the three are drawn in the order sent in every sample`, outOfOrder.length === 0, outOfOrder.length === 0 ? `${String(samples.length)} samples` : JSON.stringify(outOfOrder[0].rows));
    const regressed = [];
    const read = new Set();
    for (const entry of samples) {
      for (const row of entry.rows) {
        if (!row.queued) read.add(row.word);
        else if (read.has(row.word)) regressed.push({ word: row.word, label: row.label });
      }
    }
    check(`B3 page ${name}: no message drawn as queued after it was drawn as read`, regressed.length === 0, regressed.length === 0 ? undefined : JSON.stringify(regressed.slice(0, 3)));
    const doubled = samples.filter((entry) => new Set(entry.rows.map((row) => row.word)).size !== entry.rows.length);
    check(`B6 page ${name}: each message is drawn once in every sample`, doubled.length === 0, doubled.length === 0 ? undefined : JSON.stringify(doubled[0].rows));
    const firstTimes = {};
    const moved = [];
    for (const entry of samples) {
      for (const [word, time] of Object.entries(entry.times)) {
        if (time === null) continue;
        if (firstTimes[word] === undefined) firstTimes[word] = time;
        else if (firstTimes[word] !== time && !moved.some((item) => item.word === word)) moved.push({ word, first: firstTimes[word], later: time });
      }
    }
    check(`B5 page ${name}: each message keeps the time it was first shown with`, moved.length === 0 && Object.keys(firstTimes).length === 3, moved.length === 0 ? JSON.stringify(firstTimes) : JSON.stringify(moved));
  }
  const lastTimes = (samples) => Object.assign({}, ...samples.map((entry) => Object.fromEntries(Object.entries(entry.times).filter(([, time]) => time !== null))));
  const timesA = lastTimes(samplesA);
  const timesB = lastTimes(samplesB);
  check("B5: both pages show each message with the same time", Object.keys(timesA).length === 3 && JSON.stringify(timesA) === JSON.stringify(timesB), JSON.stringify({ A: timesA, B: timesB }));
  const endA = samplesA.at(-1)?.rows ?? [];
  const endB = samplesB.at(-1)?.rows ?? [];
  check("B6: page B ends with the same rows as page A", JSON.stringify(endA) === JSON.stringify(endB), JSON.stringify({ A: endA, B: endB }));
  check("nothing is left queued once the session settles", settledAt !== undefined, settledAt === undefined ? "did not settle in 150 s" : undefined);
  const labels = new Set([...samplesA, ...samplesB].flatMap((entry) => entry.rows.map((row) => `${row.queued ? "queued" : "read"}:${row.label}`)));
  console.log(`labels seen: ${[...labels].join(" | ")}`);
} finally {
  await browser.close();
  if (sessionId !== undefined) await api(`sessions/${sessionId}/archive`, { method: "POST", body: JSON.stringify({ cwd: CWD }) }).catch(() => undefined);
  server.close();
}
const failed = results.filter((pass) => !pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
