import { createServer } from "node:http";
import WebSocket from "ws";

/**
 * A quiet session socket carries a small heartbeat that says where the session stands.
 *
 * Owner, 2026-09-30: a page pulls only when its quiet window T passes with nothing received,
 * and heartbeats stay small (docs/design/sync-convergence.md, phase A). A page names T on its
 * event socket (`quiet=<seconds>`); the daemon then sends a keepalive after 0.6 T of quiet,
 * with the stream position and transcript head under `head`. This probe checks that on the
 * real daemon, against the head `/messages` answers with, and that a socket naming no window
 * keeps the old 20 s keepalive. The `pi-web-probe/flaky` provider gives the session a turn.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const CWD = process.env.PROBE_CWD ?? "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
function leg(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` - ${detail}`}`);
}

const server = createServer((request, response) => {
  request.resume();
  request.on("end", () => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    const chunk = (delta, finish) => `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "flaky", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    response.write(chunk({ role: "assistant", content: "heartbeat probe reply" }, null));
    response.write(chunk({}, "stop"));
    response.end("data: [DONE]\n\n");
  });
});
await new Promise((resolve) => server.listen(18999, "127.0.0.1", resolve));

const api = (path, init) => fetch(`${BASE}/api/${path}`, { headers: { "content-type": "application/json" }, ...init }).then((response) => response.json());
const created = await api("sessions", { method: "POST", body: JSON.stringify({ cwd: CWD }) });
const sessionId = created.id;
if (typeof sessionId !== "string") throw new Error(`no session: ${JSON.stringify(created)}`);
await api(`sessions/${sessionId}/model`, { method: "POST", body: JSON.stringify({ cwd: CWD, provider: "pi-web-probe", modelId: "flaky" }) });
await api(`sessions/${sessionId}/prompt`, { method: "POST", body: JSON.stringify({ cwd: CWD, text: "heartbeat probe" }) });
for (let attempt = 0; attempt < 60; attempt += 1) {
  await sleep(1000);
  if ((await api(`sessions/${sessionId}/status?cwd=${encodeURIComponent(CWD)}`)).isStreaming !== true) break;
}

function listen(query, seconds) {
  return new Promise((resolve) => {
    const frames = [];
    const socket = new WebSocket(`${BASE.replace(/^http/u, "ws")}/api/sessions/${sessionId}/events?cwd=${encodeURIComponent(CWD)}${query}`);
    socket.on("message", (data) => { frames.push({ at: Date.now(), text: data.toString() }); });
    const opened = Date.now();
    setTimeout(() => { socket.close(); resolve({ opened, frames }); }, seconds * 1000);
  });
}

try {
  const page = await api(`sessions/${sessionId}/messages?cwd=${encodeURIComponent(CWD)}&limit=10`);
  leg("precondition: the session has a transcript", (page.total ?? 0) >= 2, `total ${String(page.total)}`);

  const quiet = await listen("&quiet=5", 10);
  const keepalives = quiet.frames.filter((frame) => JSON.parse(frame.text).type === "keepalive");
  const timeline = quiet.frames.map((frame) => `${((frame.at - quiet.opened) / 1000).toFixed(1)}s ${String(JSON.parse(frame.text).type)}`).join(", ");
  const quietBefore = quiet.frames.map((frame, index) => ({ frame, gap: frame.at - (index === 0 ? quiet.opened : (quiet.frames[index - 1]?.at ?? quiet.opened)) })).filter((entry) => JSON.parse(entry.frame.text).type === "keepalive");
  leg("a socket naming a 5 s window gets a heartbeat within 10 s", keepalives.length >= 1, timeline);
  leg("each heartbeat comes only after 3 s with nothing else on the socket", quietBefore.length > 0 && quietBefore.every((entry) => entry.gap >= 2_900), quietBefore.map((entry) => `${String(entry.gap)} ms`).join(", "));
  const first = keepalives[0] === undefined ? {} : JSON.parse(keepalives[0].text);
  leg("the heartbeat carries the transcript head /messages answers with", first.head?.leaf === page.head?.leaf && first.head?.n === page.head?.n && page.head?.leaf !== undefined, `heartbeat ${JSON.stringify(first.head)}, page ${JSON.stringify(page.head)}`);
  leg("and the stream position, nested under head", typeof first.head?.seq === "number" && typeof first.head?.epoch === "string");
  leg("with no top-level seq for the gap repair to mistake for a frame", first.seq === undefined);
  leg("and stays small", (keepalives[0]?.text.length ?? 0) > 0 && (keepalives[0]?.text.length ?? 999) < 200, `${String(keepalives[0]?.text.length)} bytes`);

  const plain = await listen("", 12);
  leg("a socket naming no window keeps the 20 s keepalive", plain.frames.filter((frame) => JSON.parse(frame.text).type === "keepalive").length === 0);
} finally {
  server.close();
}

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? `ALL ${String(results.length)} LEGS PASS` : `${String(failed)} of ${String(results.length)} LEGS FAILED`);
process.exitCode = failed === 0 ? 0 : 1;
