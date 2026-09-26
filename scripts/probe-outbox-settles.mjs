import { chromium } from "@playwright/test";
import { openProbedSession } from "./probeSession.mjs";

/**
 * A message the daemon has is not "Unsent", whatever the POST said.
 *
 * The reader's report: the transcript showed their message while a turn ran, and
 * the outbox below the composer still read "Unsent / Retry / Discard" - two
 * states that cannot coexist. The send call and the daemon's acceptance frame are
 * two reports of one fact, and on a phone both can go missing while the message
 * arrives.
 *
 * This probe holds the POST for longer than the client's deadline so the browser
 * gives up while the daemon still receives it, then requires the outbox row to go
 * once the transcript proves delivery.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const CWD = process.env.PROBE_CWD ?? "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";
const SESSION = process.env.PI_WEB_PROBE_SESSION ?? "01a05000-5eed-7c00-8000-0000000000c1";
const HOLD_MS = Number(process.env.PROBE_HOLD_MS ?? 34000); // longer than the client's 30s deadline

function fail(message) {
  console.log(`FAIL ${message}`);
  process.exitCode = 1;
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let held = 0;
  // route.fetch() sends the request now and hands back the response, so the
  // daemon accepts while the browser still waits - the real shape of the loss.
  // A plain continue() after the sleep means an aborted fetch cancels the
  // request and the daemon never sees it, which is a different story.
  await page.route("**/prompt", async (route) => {
    held += 1;
    const response = await route.fetch();
    const body = await response.text();
    await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
    await route.fulfill({ response, body }).catch(() => undefined);
  });
  await openProbedSession(page, BASE);

  const mark = `outbox-settle-${String(Date.now())}`;
  const state = await page.evaluate(async ({ mark }) => {
    const app = document.querySelector("pi-web-app");
    const editor = app.shadowRoot.querySelector("prompt-editor");
    const outboxRows = () => {
      const rows = editor.shadowRoot.querySelectorAll(".pending-prompt-text");
      return [...rows].map((node) => (node.textContent ?? "").trim());
    };
    // A turn has to be running: that is the shape the owner photographed.
    await fetch(`/api/sessions/${app.state.selectedSession.id}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: app.state.selectedSession.cwd, text: "Run the bash tool with exactly: sleep 50. Then reply done." }),
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    editor.draft = mark;
    await editor.updateComplete;
    Reflect.apply(Reflect.get(editor, "send"), editor, ["followUp"]);
    return { mark, before: outboxRows() };
  }, { mark });
  console.log(`sent ${mark} while a turn runs (rows before: ${JSON.stringify(state.before)})`);

  let last = "";
  let sawUnsent = false;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await page.waitForTimeout(2500);
    last = await page.evaluate(async ({ mark }) => {
      const app = document.querySelector("pi-web-app");
      const editor = app.shadowRoot.querySelector("prompt-editor");
      // The daemon's own transcript, not the optimistic bubble: the bubble is in
      // state.messages the instant the reader presses send, so it proves nothing.
      const answer = await fetch(`/api/sessions/${app.state.selectedSession.id}/messages?cwd=${encodeURIComponent(app.state.selectedSession.cwd ?? "")}`).then((response) => response.json()).catch(() => undefined);
      const inTranscript = JSON.stringify(answer ?? {}).includes(mark);
      const rows = [...editor.shadowRoot.querySelectorAll(".pending-prompt")].map((node) => ({
        text: (node.querySelector(".pending-prompt-text")?.textContent ?? "").trim(),
        state: (node.querySelector(".pending-prompt-state")?.textContent ?? "").trim(),
      }));
      return { inTranscript, rows, streaming: app.state.status?.isStreaming === true };
    }, { mark });
    if (attempt < 8) console.log(`  poll ${String(attempt)}: ${JSON.stringify(last)}`);
    if (last.rows.some((row) => row.state === "Unsent")) sawUnsent = true;
    if (last.inTranscript && last.rows.length === 0) break;
  }
  console.log("final:", JSON.stringify(last), `· posts held: ${String(held)} · saw it unsent: ${String(sawUnsent)}`);
  if (!last.inTranscript) fail("the message never reached the transcript - proves nothing");
  else if (last.rows.length > 0) fail(`the transcript has the message but the outbox still shows ${JSON.stringify(last.rows)}`);
  else if (!sawUnsent) console.log("the POST did not time out this run");
  else console.log("the outbox row retired once the transcript proved delivery");

  // The frame path also clears the row, so the check above passes even without
  // the backstop. Put the entry back under the delivered id - exactly what a
  // send that reported failure and a lost acceptance frame leave behind - and
  // require the transcript alone to retire it.
  const backstop = await page.evaluate(async ({ mark }) => {
    const app = document.querySelector("pi-web-app");
    const session = app.state.selectedSession;
    const line = (app.state.messages ?? []).find((candidate) => JSON.stringify(candidate.parts ?? []).includes(mark));
    const id = line?.meta?.delivery?.clientMessageId ?? line?.meta?.clientMessageId ?? line?.meta?.echoClientMessageId;
    if (id === undefined) return { skipped: "the delivered line carries no minted id" };
    const key = `pi-web:pending-prompt:local:${session.id}`;
    const before = JSON.parse(localStorage.getItem(key) ?? "[]");
    localStorage.setItem(key, JSON.stringify([...before, { text: mark, clientMessageId: id, at: new Date().toISOString() }]));
    app.requestUpdate();
    await app.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const rows = [...app.shadowRoot.querySelector("prompt-editor").shadowRoot.querySelectorAll(".pending-prompt")].map((node) => (node.querySelector(".pending-prompt-state")?.textContent ?? "").trim());
    const stored = JSON.parse(localStorage.getItem(key) ?? "[]");
    return { rows, storedIds: stored.map((entry) => entry.clientMessageId) };
  }, { mark });
  console.log("backstop:", JSON.stringify(backstop));
  if (backstop.skipped !== undefined) console.log(`SKIP the restored-entry backstop — ${backstop.skipped}`);
  else if (backstop.storedIds.length > 0 || backstop.rows.length > 0) {
    fail(`a restored outbox entry under a delivered id survived the transcript proof (${JSON.stringify(backstop)})`);
  } else console.log("PASS a restored outbox entry is retired by the transcript alone");
} finally {
  await browser.close();
}
